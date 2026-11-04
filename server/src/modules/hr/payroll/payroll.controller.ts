import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import { ensureDefaultComponents, computePayslip, periodFor, defaultPeriodInputs, inputsFromAttendance, type Overrides } from '../../../utils/payrollEngine';
import { payrollSummary } from '../../../utils/attendanceRegister';
import { ensureDefaultCycle, employeeContext, toDef } from './payrollConfig.controller';
import { ensureDefaultTemplate, resolveTemplate } from './payslipTemplates.controller';

const MANAGER_ROLES = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'];

// ─── Salary Structures ───────────────────────────────────────────────────────

const structureInclude = {
  user: { select: { id: true, name: true, email: true, department: true, avatarUrl: true } },
};

const StructureSchema = z.object({
  userId:          z.string(),
  basic:           z.coerce.number().min(0),
  hra:             z.coerce.number().min(0).default(0),
  allowances:      z.coerce.number().min(0).default(0),
  pfPercent:       z.coerce.number().min(0).max(100).default(12),
  professionalTax: z.coerce.number().min(0).default(0),
  otherDeductions: z.coerce.number().min(0).default(0),
  effectiveFrom:   z.string(), // YYYY-MM-DD
});

function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** GET /hr/payroll/structures — every employee's current active salary structure (managers only) */
export async function listStructures(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const structures = await prisma.salaryStructure.findMany({
      where: { orgId: req.user!.orgId, isActive: true },
      include: structureInclude,
      orderBy: { user: { name: 'asc' } },
    });
    res.json(structures);
  } catch (err) { next(err); }
}

/** POST /hr/payroll/structures — set (or revise) an employee's salary structure.
 *  Any existing active structure for that employee is deactivated first, so
 *  payslips already generated keep pointing at the structure that was
 *  actually in effect at the time — this is a revision, not an in-place edit. */
export async function upsertStructure(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = StructureSchema.parse(req.body);

    const employee = await prisma.user.findFirst({ where: { id: data.userId, orgId, isActive: true } });
    if (!employee) throw new AppError(404, 'Employee not found');

    const [, structure] = await prisma.$transaction([
      prisma.salaryStructure.updateMany({ where: { orgId, userId: data.userId, isActive: true }, data: { isActive: false } }),
      prisma.salaryStructure.create({
        data: {
          orgId,
          userId: data.userId,
          basic: data.basic,
          hra: data.hra,
          allowances: data.allowances,
          pfPercent: data.pfPercent,
          professionalTax: data.professionalTax,
          otherDeductions: data.otherDeductions,
          effectiveFrom: parseDateOnly(data.effectiveFrom),
        },
        include: structureInclude,
      }),
    ]);

    logAction(req.user!.id, 'CREATE', 'SalaryStructure', structure.id, { userId: data.userId });
    res.status(201).json(structure);
  } catch (err) { next(err); }
}

/** DELETE /hr/payroll/structures/:id — take an employee off payroll (e.g. offboarding); soft-delete, keeps history */
export async function deactivateStructure(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.salaryStructure.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Salary structure not found');
    await prisma.salaryStructure.update({ where: { id: existing.id }, data: { isActive: false } });
    res.json({ message: 'Salary structure deactivated' });
  } catch (err) { next(err); }
}

// ─── Payroll Runs (component-based, draft → review → finalise) ───────────────

const RunSchema = z.object({
  /** Cycle to run; default cycle when omitted */
  payrollCycleId: z.string().optional(),
  /** ATTENDANCE (default) derives paid/LOP/OT days from the attendance register; CALENDAR pays every day. */
  attendanceMode: z.enum(['ATTENDANCE', 'CALENDAR']).optional(),
  /** Any date inside the period to run (default: the period before today's) */
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Legacy monthly shape still accepted
  month: z.coerce.number().int().min(1).max(12).optional(),
  year:  z.coerce.number().int().min(2000).max(2100).optional(),
});

const runInclude = {
  runByUser: { select: { id: true, name: true } },
  payrollCycle: { select: { id: true, name: true, frequency: true } },
  payslips: { include: { user: { select: { id: true, name: true, avatarUrl: true, department: true } }, lines: { orderBy: { displayOrder: 'asc' as const } } }, orderBy: { user: { name: 'asc' as const } } },
};

/** Sequential per-org display number, e.g. "PAY-2026-08-0001" — same
 *  count-then-format approach as Invoice.invoiceNumber. */
async function nextPayslipNumber(orgId: string, year: number, month: number): Promise<string> {
  const count = await prisma.payslip.count({ where: { orgId, year, month } });
  return `PAY-${year}-${String(month).padStart(2, '0')}-${String(count + 1).padStart(4, '0')}`;
}

/** Compute + write one employee's payslip (draft) for a run. */
async function buildPayslip(orgId: string, run: { id: string; periodStart: Date; periodEnd: Date; month: number; year: number; payrollCycleId: string | null; attendanceMode?: string | null }, es: { id: string; userId: string; overrides: any; ctcAnnual: any; currency: string }, comps: any[], cycle: any) {
  const period = periodFor(cycle, run.periodStart);
  const useAttendance = (run.attendanceMode ?? 'ATTENDANCE') !== 'CALENDAR';
  let inputs = defaultPeriodInputs(period);
  let attendanceSummary: any = { source: 'calendar' };
  if (useAttendance) {
    const s = await payrollSummary(orgId, es.userId, run.periodStart, run.periodEnd);
    inputs = inputsFromAttendance(period, s);
    attendanceSummary = {
      source: 'attendance', policyGroup: s.policyGroupName, byStatus: s.byStatus, absentDays: s.absentDays, unpaidLeaveDays: s.unpaidLeaveDays,
      lateCount: s.lateCount, lateConversion: s.lateConversion, futureDaysAssumedPaid: s.futureDaysAssumedPaid, manualCorrections: s.manualCorrections,
    };
  }
  const ctx = await employeeContext(orgId, es.userId);
  const result = computePayslip(comps.map(toDef), (es.overrides ?? {}) as Overrides, ctx, inputs, es.ctcAnnual != null ? Number(es.ctcAnnual) : null);
  const g = (code: string) => result.lines.find(l => l.code === code)?.amount ?? 0;
  const payslipNumber = await nextPayslipNumber(orgId, run.year, run.month);
  return prisma.payslip.create({
    data: {
      orgId, userId: es.userId, payrollRunId: run.id, employeeSalaryId: es.id, payslipNumber,
      month: run.month, year: run.year, periodStart: run.periodStart, periodEnd: run.periodEnd, currency: es.currency,
      workingDays: inputs.workingDays, presentDays: inputs.presentDays, paidDays: inputs.paidDays, leaveDays: inputs.leaveDays,
      lopDays: inputs.lopDays, halfDays: inputs.halfDays, overtimeHours: inputs.overtimeHours,
      attendanceSummary: { ...attendanceSummary, warnings: result.warnings },
      // legacy denormalised columns so older views keep working
      basic: g('BASIC'), hra: g('HRA'), allowances: Math.max(0, result.totals.earnings - g('BASIC') - g('HRA')),
      grossPay: result.totals.earnings, pf: g('PF_EMP'), professionalTax: g('PT'),
      otherDeductions: Math.max(0, result.totals.deductions - g('PF_EMP') - g('PT')),
      totalDeductions: result.totals.deductions, netPay: result.totals.net,
      totalEarnings: result.totals.earnings, totalReimbursements: result.totals.reimbursements, employerContributions: result.totals.employerContributions,
      status: 'DRAFT',
      lines: { create: result.lines.map(l => ({ code: l.code, name: l.name, category: l.category, amount: l.amount, basis: l.basis, showOnPayslip: l.showOnPayslip, displayOrder: l.displayOrder })) },
    },
  });
}

/** POST /hr/payroll/runs — compute a DRAFT run for a cycle's period. Nothing is issued until finalised. */
export async function runPayroll(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const body = RunSchema.parse(req.body);
    await ensureDefaultComponents(orgId);
    const cycle = body.payrollCycleId
      ? await prisma.payrollCycle.findFirst({ where: { id: body.payrollCycleId, orgId } })
      : await ensureDefaultCycle(orgId);
    if (!cycle) throw new AppError(404, 'Payroll cycle not found');

    const on = body.on ? parseDateOnly(body.on)
      : body.month && body.year ? new Date(Date.UTC(body.year, body.month - 1, 1))
      : new Date(periodFor(cycle, new Date()).start.getTime() - 86_400_000); // previous period by default
    const period = periodFor(cycle, on);
    const month = period.start.getUTCMonth() + 1, year = period.start.getUTCFullYear();

    const existing = await prisma.payrollRun.findFirst({ where: { orgId, payrollCycleId: cycle.id, periodStart: period.start } });
    if (existing) throw new AppError(400, `Payroll for ${period.label} (${cycle.name}) already exists — open it to review or finalise.`);

    const salaries = await prisma.employeeSalary.findMany({ where: { orgId, isActive: true, payrollCycleId: cycle.id, user: { isActive: true } } });
    if (salaries.length === 0) throw new AppError(400, `No employees are assigned to the ${cycle.name} cycle with a salary set up.`);
    const comps = await prisma.salaryComponent.findMany({ where: { orgId } });

    const attendanceMode = body.attendanceMode ?? 'ATTENDANCE';
    const run = await prisma.payrollRun.create({ data: { orgId, month, year, payrollCycleId: cycle.id, periodStart: period.start, periodEnd: period.end, status: 'DRAFT', runBy: req.user!.id, attendanceMode } });
    for (const es of salaries) await buildPayslip(orgId, { ...run, periodStart: period.start, periodEnd: period.end }, es, comps, cycle);

    logAction(req.user!.id, 'CREATE', 'PayrollRun', run.id, { cycle: cycle.name, period: period.label, count: salaries.length });
    const full = await prisma.payrollRun.findUnique({ where: { id: run.id }, include: runInclude });
    res.status(201).json(full);
  } catch (err) { next(err); }
}

/** POST /hr/payroll/runs/:id/recalculate — recompute every DRAFT payslip (after changing components/salaries). Adjusted lines are kept. */
export async function recalculateRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, orgId }, include: { payslips: { include: { lines: true } }, payrollCycle: true } });
    if (!run) throw new AppError(404, 'Payroll run not found');
    if (run.status !== 'DRAFT') throw new AppError(400, 'Only draft runs can be recalculated');
    const comps = await prisma.salaryComponent.findMany({ where: { orgId } });
    const cycle = run.payrollCycle ?? { frequency: 'MONTHLY' };
    for (const p of run.payslips) {
      const es = await prisma.employeeSalary.findFirst({ where: { orgId, userId: p.userId, isActive: true } });
      if (!es) continue;
      const adjusted = p.lines.filter(l => l.adjusted).map(l => ({ code: l.code, amount: Number(l.amount) }));
      await prisma.payslip.delete({ where: { id: p.id } });
      const fresh = await buildPayslip(orgId, { id: run.id, periodStart: run.periodStart!, periodEnd: run.periodEnd!, month: run.month, year: run.year, payrollCycleId: run.payrollCycleId, attendanceMode: run.attendanceMode }, es, comps, cycle);
      for (const a of adjusted) await applyAdjustment(fresh.id, a.code, a.amount);
    }
    logAction(req.user!.id, 'UPDATE', 'PayrollRun', run.id, { action: 'recalculate' });
    res.json(await prisma.payrollRun.findUnique({ where: { id: run.id }, include: runInclude }));
  } catch (err) { next(err); }
}

/** Overwrite one line's amount and re-total the payslip. */
async function applyAdjustment(payslipId: string, code: string, amount: number) {
  const line = await prisma.payslipLine.findFirst({ where: { payslipId, code } });
  if (!line) throw new AppError(404, `Line ${code} not found on this payslip`);
  await prisma.payslipLine.update({ where: { id: line.id }, data: { amount, adjusted: true } });
  const lines = await prisma.payslipLine.findMany({ where: { payslipId } });
  const sum = (cat: string) => Math.round(lines.filter(l => l.category === cat).reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
  const earnings = sum('EARNING'), deductions = sum('DEDUCTION'), reimb = sum('REIMBURSEMENT'), employer = sum('EMPLOYER_CONTRIBUTION');
  const g = (c: string) => Number(lines.find(l => l.code === c)?.amount ?? 0);
  await prisma.payslip.update({
    where: { id: payslipId },
    data: {
      basic: g('BASIC'), hra: g('HRA'), allowances: Math.max(0, earnings - g('BASIC') - g('HRA')), grossPay: earnings,
      pf: g('PF_EMP'), professionalTax: g('PT'), otherDeductions: Math.max(0, deductions - g('PF_EMP') - g('PT')),
      totalDeductions: deductions, netPay: Math.round((earnings + reimb - deductions) * 100) / 100,
      totalEarnings: earnings, totalReimbursements: reimb, employerContributions: employer,
    },
  });
}

/** PATCH /hr/payroll/runs/:id/payslips/:payslipId — adjust a line during review ({ code, amount }) */
export async function adjustDraftPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { code, amount } = z.object({ code: z.string(), amount: z.coerce.number().min(0) }).parse(req.body);
    const payslip = await prisma.payslip.findFirst({ where: { id: req.params.payslipId, payrollRunId: req.params.id, orgId: req.user!.orgId }, include: { payrollRun: true } });
    if (!payslip) throw new AppError(404, 'Payslip not found');
    if (payslip.payrollRun.status !== 'DRAFT') throw new AppError(400, 'Only draft payslips can be adjusted');
    await applyAdjustment(payslip.id, code, amount);
    logAction(req.user!.id, 'UPDATE', 'Payslip', payslip.id, { action: 'adjust', code, amount });
    res.json(await prisma.payslip.findUnique({ where: { id: payslip.id }, include: { lines: { orderBy: { displayOrder: 'asc' } }, user: { select: { id: true, name: true } } } }));
  } catch (err) { next(err); }
}

/** DELETE /hr/payroll/runs/:id — discard a draft */
export async function discardRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!run) throw new AppError(404, 'Payroll run not found');
    if (run.status !== 'DRAFT') throw new AppError(400, 'Only draft runs can be discarded');
    await prisma.payrollRun.delete({ where: { id: run.id } });
    logAction(req.user!.id, 'DELETE', 'PayrollRun', run.id, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** POST /hr/payroll/runs/:id/finalize — issue the payslips (DRAFT → PROCESSED) */
export async function finalizeRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!run) throw new AppError(404, 'Payroll run not found');
    if (run.status !== 'DRAFT') throw new AppError(400, 'This run is already finalised');
    // Pin each payslip to the template that applies to the employee today, so
    // later template edits never restyle an issued document.
    const slips = await prisma.payslip.findMany({ where: { payrollRunId: run.id }, select: { id: true, userId: true } });
    const pins: { id: string; templateId: string }[] = [];
    for (const s of slips) {
      const emp = await prisma.employee.findFirst({ where: { orgId: run.orgId, userId: s.userId }, select: { departmentId: true, locationId: true, employmentType: true } });
      const t = await resolveTemplate(run.orgId, emp);
      pins.push({ id: s.id, templateId: t.id });
    }
    await prisma.$transaction([
      ...pins.map(p => prisma.payslip.update({ where: { id: p.id }, data: { status: 'GENERATED', templateId: p.templateId } })),
      prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'PROCESSED', finalizedAt: new Date() } }),
    ]);
    logAction(req.user!.id, 'UPDATE', 'PayrollRun', run.id, { action: 'finalize' });
    res.json(await prisma.payrollRun.findUnique({ where: { id: run.id }, include: runInclude }));
  } catch (err) { next(err); }
}

/** GET /hr/payroll/runs — managers only */
export async function listRuns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const runs = await prisma.payrollRun.findMany({
      where: { orgId: req.user!.orgId },
      include: { runByUser: { select: { id: true, name: true } }, payrollCycle: { select: { id: true, name: true, frequency: true } }, _count: { select: { payslips: true } } },
      orderBy: [{ periodStart: 'desc' }, { year: 'desc' }, { month: 'desc' }],
    });
    res.json(runs);
  } catch (err) { next(err); }
}

/** GET /hr/payroll/runs/:id — managers only */
export async function getRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include: runInclude });
    if (!run) throw new AppError(404, 'Payroll run not found');
    res.json(run);
  } catch (err) { next(err); }
}

/** PATCH /hr/payroll/runs/:id/mark-paid — marks the run and every one of its still-GENERATED payslips as PAID */
export async function markRunPaid(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!run) throw new AppError(404, 'Payroll run not found');
    if (run.status === 'DRAFT') throw new AppError(400, 'Finalise the run before marking it paid');

    const paidAt = new Date();
    await prisma.$transaction([
      prisma.payslip.updateMany({ where: { payrollRunId: run.id, status: 'GENERATED' }, data: { status: 'PAID', paidAt } }),
      prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'PAID' } }),
    ]);

    logAction(req.user!.id, 'UPDATE', 'PayrollRun', run.id, { action: 'marked paid' });
    const full = await prisma.payrollRun.findUnique({ where: { id: run.id }, include: runInclude });
    res.json(full);
  } catch (err) { next(err); }
}

// ─── Payslips ────────────────────────────────────────────────────────────────

const payslipInclude = {
  user: { select: { id: true, name: true, email: true, department: true, avatarUrl: true } },
  org: { select: { name: true } },
  lines: { orderBy: { displayOrder: 'asc' as const } },
  payrollRun: { select: { id: true, status: true, periodStart: true, periodEnd: true, payrollCycle: { select: { name: true, frequency: true } } } },
};

/** GET /hr/payroll/payslips — self sees own; managers can pass ?scope=org to see everyone's */
export async function listPayslips(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { scope, userId, month, year } = req.query as Record<string, string>;
    const isManager = MANAGER_ROLES.includes(req.user!.role);

    const where: any = { orgId };
    if (isManager && scope === 'org') {
      if (userId) where.userId = userId;
    } else {
      where.userId = req.user!.id;
      where.status = { not: 'DRAFT' }; // drafts are visible to managers only, in the run review
    }
    if (month) where.month = Number(month);
    if (year) where.year = Number(year);

    const payslips = await prisma.payslip.findMany({
      where, include: payslipInclude,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    res.json(payslips);
  } catch (err) { next(err); }
}

/** GET /hr/payroll/payslips/:id — an employee can only view their own; managers can view anyone's */
export async function getPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const payslip = await prisma.payslip.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include: payslipInclude });
    if (!payslip) throw new AppError(404, 'Payslip not found');
    const isManager = MANAGER_ROLES.includes(req.user!.role);
    if (!isManager && payslip.userId !== req.user!.id) throw new AppError(403, 'You can only view your own payslips');
    if (!isManager && payslip.status === 'DRAFT') throw new AppError(404, 'Payslip not found');
    res.json(payslip);
  } catch (err) { next(err); }
}

/** PATCH /hr/payroll/payslips/:id/mark-paid — managers only */
export async function markPayslipPaid(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const payslip = await prisma.payslip.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!payslip) throw new AppError(404, 'Payslip not found');
    const updated = await prisma.payslip.update({
      where: { id: payslip.id },
      data: { status: 'PAID', paidAt: new Date() },
      include: payslipInclude,
    });
    logAction(req.user!.id, 'UPDATE', 'Payslip', payslip.id, { action: 'marked paid' });
    res.json(updated);
  } catch (err) { next(err); }
}

// ─── Legacy single-template endpoints (kept for older clients) ──────────────
// The default template is what GET /template returns; PUT /template edits it.
// Full multi-template management lives in payslipTemplates.controller.ts.

const LegacyTemplateSchema = z.object({
  companyName:    z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional()),
  companyAddress: z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional()),
  logoUrl:        z.preprocess(v => (v === '' ? null : v), z.string().url().nullable().optional()),
  primaryColor:   z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  footerNote:     z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional()),
  showSignature:  z.boolean().optional(),
  signatureLabel: z.string().optional(),
});

/** GET /hr/payroll/template — the org's default template */
export async function getTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await ensureDefaultTemplate(req.user!.orgId)); } catch (err) { next(err); }
}

/** PUT /hr/payroll/template — edit the default template's letterhead fields */
export async function saveTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = LegacyTemplateSchema.parse(req.body);
    const t = await ensureDefaultTemplate(req.user!.orgId);
    const template = await prisma.payslipTemplate.update({ where: { id: t.id }, data: data as any });
    logAction(req.user!.id, 'UPDATE', 'PayslipTemplate', template.id, {});
    res.json(template);
  } catch (err) { next(err); }
}
