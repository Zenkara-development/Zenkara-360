// ─── Payroll calculation engine ──────────────────────────────────────────────
//
// Turns an org's SalaryComponent catalogue + an employee's EmployeeSalary
// overrides + the period's attendance figures into payslip lines. Pure where
// it matters (computePayslip) so it can be unit-tested and previewed.
//
// Order of evaluation: FIXED and PERCENT-of-BASIC/other-component lines are
// resolved in dependency order (a component may reference any other by code,
// cycles are rejected); GROSS_EARNINGS-based components and statutory presets
// that need gross (ESI, PT) run after all earnings are known.

import { prisma } from './prisma';
import { evaluate, formulaRefs, validateFormula } from './payrollFormula';

export type Category = 'EARNING' | 'DEDUCTION' | 'REIMBURSEMENT' | 'EMPLOYER_CONTRIBUTION';
export type CalcType = 'FIXED' | 'PERCENT' | 'FORMULA';

export interface ComponentDef {
  code: string;
  name: string;
  category: Category;
  calcType: CalcType;
  amount?: number | null;
  percent?: number | null;
  percentOf?: string | null;
  formula?: string | null;
  statutory?: string | null;
  statutoryConfig?: any;
  prorate: boolean;
  taxable: boolean;
  showOnPayslip: boolean;
  displayOrder: number;
  isActive: boolean;
  applicability?: Applicability | null;
}

export interface Applicability {
  departmentIds?: string[];
  locationIds?: string[];
  designations?: string[];
  employmentTypes?: string[];
  userIds?: string[];
}

export interface EmployeeContext {
  userId: string;
  departmentId?: string | null;
  locationId?: string | null;
  designation?: string | null;
  employmentType?: string | null;
  /** Indian state code for PT slabs, e.g. "KA", "MH" */
  state?: string | null;
}

export interface Overrides { [code: string]: { amount?: number; percent?: number; formula?: string; enabled?: boolean } }

export interface PeriodInputs {
  daysInPeriod: number;      // calendar days in the pay period
  workingDays: number;       // days the employee was expected to work
  presentDays: number;
  paidDays: number;          // working days − LOP days (+ paid leave)
  leaveDays: number;
  lopDays: number;
  halfDays: number;
  overtimeHours: number;
  /** Fraction of a full month this period represents (1 for monthly, 7/30.4 for weekly …) for monthly-quoted amounts */
  periodFraction: number;
}

export interface Line {
  code: string; name: string; category: Category; amount: number; basis: string;
  showOnPayslip: boolean; displayOrder: number; taxable: boolean;
}

export interface PayslipComputation {
  lines: Line[];
  totals: { earnings: number; deductions: number; reimbursements: number; employerContributions: number; gross: number; net: number };
  vars: Record<string, number>;
  warnings: string[];
}

// ─── Statutory presets (India) — every number editable per org via statutoryConfig ──

export const STATUTORY_PRESETS: Record<string, { name: string; category: Category; description: string; defaults: any }> = {
  PF_EMP:      { name: 'Provident Fund (Employee)', category: 'DEDUCTION',             description: '12% of PF wages (Basic + DA), capped at the wage ceiling unless "on full basic" is on', defaults: { rate: 12, wageCeiling: 15000, onFullBasic: false, base: 'BASIC' } },
  PF_EMPLOYER: { name: 'Provident Fund (Employer)', category: 'EMPLOYER_CONTRIBUTION', description: 'Employer PF share (EPF + EPS) — 12% of PF wages, same ceiling rule', defaults: { rate: 12, wageCeiling: 15000, onFullBasic: false, base: 'BASIC' } },
  ESI_EMP:     { name: 'ESI (Employee)',            category: 'DEDUCTION',             description: '0.75% of gross when gross ≤ the eligibility threshold', defaults: { rate: 0.75, threshold: 21000 } },
  ESI_EMPLOYER:{ name: 'ESI (Employer)',            category: 'EMPLOYER_CONTRIBUTION', description: '3.25% of gross when gross ≤ the eligibility threshold', defaults: { rate: 3.25, threshold: 21000 } },
  PT:          { name: 'Professional Tax',          category: 'DEDUCTION',             description: 'Monthly slab on gross; slabs are per state — edit to match yours', defaults: { slabs: [{ upTo: 15000, amount: 0 }, { upTo: 25000, amount: 150 }, { upTo: null, amount: 200 }] } },
  TDS:         { name: 'Income Tax (TDS)',          category: 'DEDUCTION',             description: 'Monthly TDS as entered per employee (override amount); no auto-computation', defaults: {} },
};

const VAR_NAMES = ['GROSS_EARNINGS', 'TOTAL_DEDUCTIONS', 'CTC', 'CTC_MONTHLY', 'PAID_DAYS', 'WORKING_DAYS', 'LOP_DAYS', 'PRESENT_DAYS', 'LEAVE_DAYS', 'HALF_DAYS', 'OVERTIME_HOURS', 'DAYS_IN_PERIOD', 'PERIOD_FRACTION', 'BASIC'];

/** Components that ship with every org (created lazily). Codes are stable; names/amounts editable. */
export const DEFAULT_COMPONENTS: Omit<ComponentDef, 'isActive'>[] = [
  { code: 'BASIC',      name: 'Basic Salary',          category: 'EARNING', calcType: 'FIXED', amount: 0, prorate: true, taxable: true, showOnPayslip: true, displayOrder: 10 },
  { code: 'HRA',        name: 'House Rent Allowance',  category: 'EARNING', calcType: 'PERCENT', percent: 40, percentOf: 'BASIC', prorate: true, taxable: true, showOnPayslip: true, displayOrder: 20 },
  { code: 'CONVEYANCE', name: 'Conveyance Allowance',  category: 'EARNING', calcType: 'FIXED', amount: 0, prorate: true, taxable: true, showOnPayslip: true, displayOrder: 30 },
  { code: 'ALLOWANCES', name: 'Other Allowances',      category: 'EARNING', calcType: 'FIXED', amount: 0, prorate: true, taxable: true, showOnPayslip: true, displayOrder: 40 },
  { code: 'SPECIAL',    name: 'Special Allowance',     category: 'EARNING', calcType: 'FIXED', amount: 0, prorate: true, taxable: true, showOnPayslip: true, displayOrder: 50 },
  { code: 'OVERTIME',   name: 'Overtime',              category: 'EARNING', calcType: 'FORMULA', formula: 'OVERTIME_HOURS * (BASIC / (WORKING_DAYS * 8)) * 2', prorate: false, taxable: true, showOnPayslip: true, displayOrder: 60 },
  { code: 'INCENTIVE',  name: 'Incentive / Bonus',     category: 'EARNING', calcType: 'FIXED', amount: 0, prorate: false, taxable: true, showOnPayslip: true, displayOrder: 70 },
  { code: 'PF_EMP',     name: 'Provident Fund',        category: 'DEDUCTION', calcType: 'FORMULA', statutory: 'PF_EMP', prorate: false, taxable: false, showOnPayslip: true, displayOrder: 100 },
  { code: 'ESI_EMP',    name: 'ESI',                   category: 'DEDUCTION', calcType: 'FORMULA', statutory: 'ESI_EMP', prorate: false, taxable: false, showOnPayslip: true, displayOrder: 110 },
  { code: 'PT',         name: 'Professional Tax',      category: 'DEDUCTION', calcType: 'FORMULA', statutory: 'PT', prorate: false, taxable: false, showOnPayslip: true, displayOrder: 120 },
  { code: 'TDS',        name: 'Income Tax (TDS)',      category: 'DEDUCTION', calcType: 'FIXED', amount: 0, statutory: 'TDS', prorate: false, taxable: false, showOnPayslip: true, displayOrder: 130 },
  { code: 'OTHER_DED',  name: 'Other Deductions',      category: 'DEDUCTION', calcType: 'FIXED', amount: 0, prorate: false, taxable: false, showOnPayslip: true, displayOrder: 140 },
  { code: 'LOP',        name: 'Loss of Pay',           category: 'DEDUCTION', calcType: 'FORMULA', formula: 'if(WORKING_DAYS > 0, round(GROSS_EARNINGS_UNPRORATED / WORKING_DAYS * LOP_DAYS, 2), 0)', prorate: false, taxable: false, showOnPayslip: true, displayOrder: 150 },
  { code: 'REIMB',      name: 'Reimbursements',        category: 'REIMBURSEMENT', calcType: 'FIXED', amount: 0, prorate: false, taxable: false, showOnPayslip: true, displayOrder: 200 },
  { code: 'PF_EMPLOYER',name: 'Employer PF',           category: 'EMPLOYER_CONTRIBUTION', calcType: 'FORMULA', statutory: 'PF_EMPLOYER', prorate: false, taxable: false, showOnPayslip: false, displayOrder: 300 },
  { code: 'ESI_EMPLOYER',name: 'Employer ESI',         category: 'EMPLOYER_CONTRIBUTION', calcType: 'FORMULA', statutory: 'ESI_EMPLOYER', prorate: false, taxable: false, showOnPayslip: false, displayOrder: 310 },
];

/** Seed the default catalogue for an org that has none yet. Idempotent. */
export async function ensureDefaultComponents(orgId: string) {
  const count = await prisma.salaryComponent.count({ where: { orgId } });
  if (count > 0) return;
  await prisma.salaryComponent.createMany({
    data: DEFAULT_COMPONENTS.map(c => ({
      orgId, code: c.code, name: c.name, category: c.category, calcType: c.calcType,
      amount: c.amount ?? null, percent: c.percent ?? null, percentOf: c.percentOf ?? null, formula: c.formula ?? null,
      statutory: c.statutory ?? null, statutoryConfig: c.statutory ? STATUTORY_PRESETS[c.statutory].defaults : undefined,
      prorate: c.prorate, taxable: c.taxable, showOnPayslip: c.showOnPayslip, displayOrder: c.displayOrder,
      // LOP is on for everyone but only bites once attendance feeds lopDays (phase 3)
      isActive: !['CONVEYANCE', 'SPECIAL', 'OVERTIME', 'INCENTIVE', 'ESI_EMP', 'TDS', 'REIMB', 'ESI_EMPLOYER'].includes(c.code),
    })),
    skipDuplicates: true,
  });
}

export function appliesTo(c: ComponentDef, e: EmployeeContext): boolean {
  const a = c.applicability;
  if (!a) return true;
  const has = (list?: string[]) => Array.isArray(list) && list.length > 0;
  if (has(a.userIds) && a.userIds!.includes(e.userId)) return true;
  if (has(a.userIds) && !has(a.departmentIds) && !has(a.locationIds) && !has(a.designations) && !has(a.employmentTypes)) return false;
  if (has(a.departmentIds) && !(e.departmentId && a.departmentIds!.includes(e.departmentId))) return false;
  if (has(a.locationIds) && !(e.locationId && a.locationIds!.includes(e.locationId))) return false;
  if (has(a.designations) && !(e.designation && a.designations!.map(d => d.toLowerCase()).includes(e.designation.toLowerCase()))) return false;
  if (has(a.employmentTypes) && !(e.employmentType && a.employmentTypes!.includes(e.employmentType))) return false;
  return true;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function statutoryAmount(c: ComponentDef, vars: Record<string, number>, ctx: EmployeeContext): { amount: number; basis: string } {
  const cfg = { ...(STATUTORY_PRESETS[c.statutory!]?.defaults ?? {}), ...(c.statutoryConfig ?? {}) };
  switch (c.statutory) {
    case 'PF_EMP':
    case 'PF_EMPLOYER': {
      const base = vars[cfg.base || 'BASIC'] ?? 0;
      const wages = cfg.onFullBasic ? base : Math.min(base, Number(cfg.wageCeiling ?? 15000) * (vars.PERIOD_FRACTION || 1));
      return { amount: r2(wages * Number(cfg.rate) / 100), basis: `${cfg.rate}% of ${cfg.base || 'BASIC'}${cfg.onFullBasic ? '' : ` (ceiling ${cfg.wageCeiling})`}` };
    }
    case 'ESI_EMP':
    case 'ESI_EMPLOYER': {
      const gross = vars.GROSS_EARNINGS ?? 0;
      const threshold = Number(cfg.threshold ?? 21000) * (vars.PERIOD_FRACTION || 1);
      if (gross > threshold) return { amount: 0, basis: `not applicable (gross > ${threshold})` };
      return { amount: r2(gross * Number(cfg.rate) / 100), basis: `${cfg.rate}% of gross` };
    }
    case 'PT': {
      const gross = vars.GROSS_EARNINGS ?? 0;
      const slabs: { upTo: number | null; amount: number }[] = (cfg.stateSlabs && ctx.state && cfg.stateSlabs[ctx.state]) || cfg.slabs || [];
      const monthlyGross = gross / (vars.PERIOD_FRACTION || 1);
      const slab = slabs.find(s => s.upTo === null || s.upTo === undefined || monthlyGross <= Number(s.upTo));
      const amt = r2(Number(slab?.amount ?? 0) * (vars.PERIOD_FRACTION || 1));
      return { amount: amt, basis: `slab${ctx.state ? ` (${ctx.state})` : ''}` };
    }
    case 'TDS':
      return { amount: r2(Number(c.amount ?? 0)), basis: 'as entered' };
    default:
      return { amount: 0, basis: 'unknown statutory preset' };
  }
}

/**
 * Pure computation. `components` = the org catalogue (active + applicable
 * filtering happens here), `overrides` = employee values.
 */
export function computePayslip(
  components: ComponentDef[],
  overrides: Overrides,
  ctx: EmployeeContext,
  period: PeriodInputs,
  ctcAnnual?: number | null,
): PayslipComputation {
  const warnings: string[] = [];
  const active = components
    .filter(c => c.isActive && appliesTo(c, ctx) && overrides[c.code]?.enabled !== false)
    .map(c => {
      const o = overrides[c.code];
      if (!o) return c;
      const merged: ComponentDef = { ...c };
      if (o.amount !== undefined) { merged.amount = o.amount; if (!merged.statutory) merged.calcType = 'FIXED'; }
      if (o.percent !== undefined && merged.calcType === 'PERCENT') merged.percent = o.percent;
      if (o.formula) { merged.formula = o.formula; merged.calcType = 'FORMULA'; }
      return merged;
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);

  // Two ways to show unpaid days: an explicit "Loss of Pay" deduction line
  // (earnings shown in full, LOP deducted — the common Indian payslip layout)
  // or prorated earnings with no LOP line. Having an active LOP component
  // selects the first; disabling it selects the second. Never both.
  const lopAsDeduction = active.some(c => c.code === 'LOP' && c.category === 'DEDUCTION');
  const prorationFactor = lopAsDeduction ? 1 : period.workingDays > 0 ? Math.min(1, Math.max(0, period.paidDays / period.workingDays)) : 1;
  const vars: Record<string, number> = {
    PAID_DAYS: period.paidDays, WORKING_DAYS: period.workingDays, LOP_DAYS: period.lopDays, PRESENT_DAYS: period.presentDays,
    LEAVE_DAYS: period.leaveDays, HALF_DAYS: period.halfDays, OVERTIME_HOURS: period.overtimeHours,
    DAYS_IN_PERIOD: period.daysInPeriod, PERIOD_FRACTION: period.periodFraction,
    CTC: ctcAnnual ?? 0, CTC_MONTHLY: (ctcAnnual ?? 0) / 12, GROSS_EARNINGS: 0, GROSS_EARNINGS_UNPRORATED: 0, TOTAL_DEDUCTIONS: 0, BASIC: 0,
  };
  const unprorated: Record<string, number> = {};

  // Dependency order: a component may reference others by code; GROSS_/TOTAL_ vars come after their group.
  const byCode = new Map(active.map(c => [c.code, c]));
  const deps = (c: ComponentDef): string[] => {
    if (c.statutory) return c.statutory.startsWith('PF') ? [(c.statutoryConfig?.base as string) || 'BASIC'] : ['__GROSS__'];
    if (c.calcType === 'PERCENT') return [c.percentOf === 'GROSS_EARNINGS' ? '__GROSS__' : (c.percentOf || 'BASIC')];
    if (c.calcType === 'FORMULA' && c.formula) return formulaRefs(c.formula).map(r => (r === 'GROSS_EARNINGS' || r === 'GROSS_EARNINGS_UNPRORATED' ? '__GROSS__' : r === 'TOTAL_DEDUCTIONS' ? '__DED__' : r));
    return [];
  };
  const earningsCodes = new Set(active.filter(c => c.category === 'EARNING').map(c => c.code));
  const lines: Line[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  let grossReady = false, dedReady = false;

  const compute = (c: ComponentDef): number => {
    if (done.has(c.code)) return vars[c.code];
    if (visiting.has(c.code)) { warnings.push(`Circular reference involving ${c.code}`); return 0; }
    visiting.add(c.code);
    for (const d of deps(c)) {
      if (d === '__GROSS__' || d === '__DED__') continue; // handled by phases
      if (VAR_NAMES.includes(d) && d !== 'BASIC') continue;
      const dep = byCode.get(d);
      if (dep) compute(dep); else if (!(d in vars)) { vars[d] = 0; warnings.push(`${c.code} references unknown ${d} — treated as 0`); }
    }
    let raw = 0, basis = '';
    if (c.statutory) {
      const s = statutoryAmount(c, vars, ctx); raw = s.amount; basis = s.basis;
    } else if (c.calcType === 'FIXED') {
      raw = Number(c.amount ?? 0); basis = 'fixed';
    } else if (c.calcType === 'PERCENT') {
      const baseCode = c.percentOf || 'BASIC';
      const baseVal = baseCode === 'GROSS_EARNINGS' ? vars.GROSS_EARNINGS : (baseCode === 'BASIC' && unprorated.BASIC !== undefined ? unprorated.BASIC : vars[baseCode] ?? 0);
      raw = baseVal * Number(c.percent ?? 0) / 100; basis = `${c.percent}% of ${baseCode}`;
    } else if (c.calcType === 'FORMULA' && c.formula) {
      try { raw = evaluate(c.formula, vars); basis = `formula: ${c.formula}`; }
      catch (e: any) { warnings.push(`${c.code}: ${e.message}`); raw = 0; basis = 'formula error'; }
    }
    raw = r2(raw);
    unprorated[c.code] = raw;
    const amount = c.prorate && c.category === 'EARNING' ? r2(raw * prorationFactor) : raw;
    if (c.prorate && c.category === 'EARNING' && prorationFactor < 1) basis += ` × ${period.paidDays}/${period.workingDays} days`;
    vars[c.code] = amount;
    lines.push({ code: c.code, name: c.name, category: c.category, amount, basis, showOnPayslip: c.showOnPayslip, displayOrder: c.displayOrder, taxable: c.taxable });
    done.add(c.code); visiting.delete(c.code);
    return amount;
  };

  // Phase A: earnings that don't need gross
  for (const c of active) if (c.category === 'EARNING' && !deps(c).includes('__GROSS__')) compute(c);
  vars.GROSS_EARNINGS = r2(lines.filter(l => l.category === 'EARNING').reduce((s, l) => s + l.amount, 0));
  vars.GROSS_EARNINGS_UNPRORATED = r2(active.filter(c => c.category === 'EARNING' && done.has(c.code)).reduce((s, c) => s + (unprorated[c.code] ?? 0), 0));
  grossReady = true;
  // Phase B: remaining earnings (gross-based), then reimbursements
  for (const c of active) if (c.category === 'EARNING' && !done.has(c.code)) compute(c);
  vars.GROSS_EARNINGS = r2(lines.filter(l => l.category === 'EARNING').reduce((s, l) => s + l.amount, 0));
  for (const c of active) if (c.category === 'REIMBURSEMENT') compute(c);
  // Phase C: deductions (not depending on total deductions), then the rest
  for (const c of active) if (c.category === 'DEDUCTION' && !deps(c).includes('__DED__')) compute(c);
  vars.TOTAL_DEDUCTIONS = r2(lines.filter(l => l.category === 'DEDUCTION').reduce((s, l) => s + l.amount, 0));
  dedReady = true;
  for (const c of active) if (!done.has(c.code)) compute(c);
  void grossReady; void dedReady;

  const sum = (cat: Category) => r2(lines.filter(l => l.category === cat).reduce((s, l) => s + l.amount, 0));
  const earnings = sum('EARNING'), deductions = sum('DEDUCTION'), reimbursements = sum('REIMBURSEMENT'), employerContributions = sum('EMPLOYER_CONTRIBUTION');
  vars.GROSS_EARNINGS = earnings; vars.TOTAL_DEDUCTIONS = deductions;
  lines.sort((a, b) => a.displayOrder - b.displayOrder);
  return {
    lines,
    totals: { earnings, deductions, reimbursements, employerContributions, gross: earnings, net: r2(earnings + reimbursements - deductions) },
    vars, warnings,
  };
}

/** Names a formula may reference for an org: variables + active component codes. */
export function knownNames(components: { code: string }[]): string[] {
  return [...VAR_NAMES, 'GROSS_EARNINGS_UNPRORATED', ...components.map(c => c.code)];
}

export function assertValidFormula(formula: string, components: { code: string }[]) {
  validateFormula(formula, knownNames(components));
}

// ─── Pay periods ─────────────────────────────────────────────────────────────

export interface Period { start: Date; end: Date; daysInPeriod: number; periodFraction: number; label: string }

const day = 86_400_000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const AVG_MONTH_DAYS = 365.25 / 12;

/** The pay period containing `on` for a cycle. */
export function periodFor(cycle: { frequency: string; startWeekday?: number | null; anchorDate?: Date | null; lengthDays?: number | null }, on: Date): Period {
  const y = on.getUTCFullYear(), m = on.getUTCMonth(), d = on.getUTCDate();
  if (cycle.frequency === 'MONTHLY') {
    const start = utc(y, m, 1), end = utc(y, m + 1, 0);
    return { start, end, daysInPeriod: end.getUTCDate(), periodFraction: 1, label: start.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  if (cycle.frequency === 'WEEKLY' || cycle.frequency === 'BIWEEKLY') {
    const len = cycle.frequency === 'WEEKLY' ? 7 : 14;
    const sw = cycle.startWeekday ?? 1;
    const today = utc(y, m, d);
    let start = new Date(today.getTime() - ((today.getUTCDay() - sw + 7) % 7) * day);
    if (len === 14 && cycle.anchorDate) {
      const anchor = utc(cycle.anchorDate.getUTCFullYear(), cycle.anchorDate.getUTCMonth(), cycle.anchorDate.getUTCDate());
      const weeks = Math.floor((start.getTime() - anchor.getTime()) / (7 * day));
      if (((weeks % 2) + 2) % 2 === 1) start = new Date(start.getTime() - 7 * day);
    }
    const end = new Date(start.getTime() + (len - 1) * day);
    return { start, end, daysInPeriod: len, periodFraction: len / AVG_MONTH_DAYS, label: `${fmt(start)} – ${fmt(end)}` };
  }
  // CUSTOM: lengthDays from anchorDate, repeating
  const len = Math.max(1, cycle.lengthDays ?? 30);
  const anchor = cycle.anchorDate ? utc(cycle.anchorDate.getUTCFullYear(), cycle.anchorDate.getUTCMonth(), cycle.anchorDate.getUTCDate()) : utc(y, m, 1);
  const today = utc(y, m, d);
  const n = Math.floor((today.getTime() - anchor.getTime()) / (len * day));
  const start = new Date(anchor.getTime() + n * len * day);
  const end = new Date(start.getTime() + (len - 1) * day);
  return { start, end, daysInPeriod: len, periodFraction: len / AVG_MONTH_DAYS, label: `${fmt(start)} – ${fmt(end)}` };
}

export function nextPeriod(cycle: Parameters<typeof periodFor>[0], p: Period): Period { return periodFor(cycle, new Date(p.end.getTime() + day)); }
export function prevPeriod(cycle: Parameters<typeof periodFor>[0], p: Period): Period { return periodFor(cycle, new Date(p.start.getTime() - day)); }

function fmt(d: Date) { return d.toISOString().slice(0, 10); }

/** Calendar mode: every calendar day is a working, paid day (used when an org opts out of attendance-based payroll, and for what-if previews). */
export function defaultPeriodInputs(p: Period): PeriodInputs {
  return { daysInPeriod: p.daysInPeriod, workingDays: p.daysInPeriod, presentDays: p.daysInPeriod, paidDays: p.daysInPeriod, leaveDays: 0, lopDays: 0, halfDays: 0, overtimeHours: 0, periodFraction: p.periodFraction };
}

/** Attendance mode: figures from the attendance policy engine's period summary (phase 3). */
export function inputsFromAttendance(p: Period, s: { workingDays: number; presentDays: number; paidDays: number; leaveDays: number; lopDays: number; halfDays: number; overtimeHours: number }): PeriodInputs {
  return {
    daysInPeriod: p.daysInPeriod, workingDays: s.workingDays, presentDays: s.presentDays, paidDays: s.paidDays,
    leaveDays: s.leaveDays, lopDays: s.lopDays, halfDays: s.halfDays, overtimeHours: s.overtimeHours, periodFraction: p.periodFraction,
  };
}
