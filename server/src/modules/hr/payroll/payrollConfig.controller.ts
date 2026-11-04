// Salary components, payroll cycles and employee salaries — the configurable
// half of payroll. Runs/payslips live in payroll.controller.ts.
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import {
  ensureDefaultComponents, computePayslip, assertValidFormula, knownNames, periodFor, defaultPeriodInputs, inputsFromAttendance,
  STATUTORY_PRESETS, type ComponentDef, type EmployeeContext, type Overrides,
} from '../../../utils/payrollEngine';
import { payrollSummary } from '../../../utils/attendanceRegister';

const parseDateOnly = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

// ─── Components ──────────────────────────────────────────────────────────────

const ApplicabilitySchema = z.object({
  departmentIds: z.array(z.string()).optional(),
  locationIds: z.array(z.string()).optional(),
  designations: z.array(z.string()).optional(),
  employmentTypes: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
}).nullable().optional();

const ComponentSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Code must be UPPER_SNAKE (letters, digits, _)'),
  name: z.string().min(1).max(80),
  category: z.enum(['EARNING', 'DEDUCTION', 'REIMBURSEMENT', 'EMPLOYER_CONTRIBUTION']),
  calcType: z.enum(['FIXED', 'PERCENT', 'FORMULA']).default('FIXED'),
  amount: z.coerce.number().min(0).nullable().optional(),
  percent: z.coerce.number().min(0).max(1000).nullable().optional(),
  percentOf: z.string().nullable().optional(),
  formula: z.string().max(500).nullable().optional(),
  statutory: z.string().nullable().optional(),
  statutoryConfig: z.any().optional(),
  prorate: z.boolean().default(true),
  taxable: z.boolean().default(true),
  showOnPayslip: z.boolean().default(true),
  displayOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
  applicability: ApplicabilitySchema,
});

export async function listComponents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await ensureDefaultComponents(orgId);
    const components = await prisma.salaryComponent.findMany({ where: { orgId }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
    res.json({ components, statutoryPresets: STATUTORY_PRESETS, variables: knownNames([]).filter(n => n !== 'BASIC') });
  } catch (err) { next(err); }
}

export async function createComponent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = ComponentSchema.parse(req.body);
    const existing = await prisma.salaryComponent.findMany({ where: { orgId }, select: { code: true } });
    if (existing.some(c => c.code === data.code)) throw new AppError(409, `A component with code ${data.code} already exists`);
    if (data.calcType === 'FORMULA' && data.formula) assertValidFormula(data.formula, [...existing, { code: data.code }]);
    if (data.statutory && !STATUTORY_PRESETS[data.statutory]) throw new AppError(400, 'Unknown statutory preset');
    const c = await prisma.salaryComponent.create({ data: { orgId, ...data, applicability: data.applicability ?? undefined } });
    logAction(req.user!.id, 'CREATE', 'SalaryComponent', c.id, { code: c.code });
    res.status(201).json(c);
  } catch (err) { next(err); }
}

export async function updateComponent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const existing = await prisma.salaryComponent.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Component not found');
    const data = ComponentSchema.partial().parse(req.body);
    if (data.code && data.code !== existing.code) throw new AppError(400, 'Component code cannot be changed — create a new component instead');
    const all = await prisma.salaryComponent.findMany({ where: { orgId }, select: { code: true } });
    const formula = data.formula ?? existing.formula;
    if ((data.calcType ?? existing.calcType) === 'FORMULA' && formula) assertValidFormula(formula, all);
    const c = await prisma.salaryComponent.update({ where: { id: existing.id }, data: { ...data, applicability: data.applicability === null ? undefined : data.applicability } });
    logAction(req.user!.id, 'UPDATE', 'SalaryComponent', c.id, data);
    res.json(c);
  } catch (err) { next(err); }
}

export async function deleteComponent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.salaryComponent.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Component not found');
    // Soft-delete: payslip lines and formulas may still reference the code.
    await prisma.salaryComponent.update({ where: { id: existing.id }, data: { isActive: false } });
    logAction(req.user!.id, 'DELETE', 'SalaryComponent', existing.id, { code: existing.code });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function reorderComponents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { order } = z.object({ order: z.array(z.string()).min(1) }).parse(req.body);
    const orgId = req.user!.orgId;
    await prisma.$transaction(order.map((id, i) => prisma.salaryComponent.updateMany({ where: { id, orgId }, data: { displayOrder: (i + 1) * 10 } })));
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ─── Payroll cycles ──────────────────────────────────────────────────────────

const CycleSchema = z.object({
  name: z.string().min(1).max(60),
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM']).default('MONTHLY'),
  startWeekday: z.coerce.number().int().min(0).max(6).nullable().optional(),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lengthDays: z.coerce.number().int().min(1).max(366).nullable().optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

/** Every org gets a default monthly cycle. */
export async function ensureDefaultCycle(orgId: string) {
  const existing = await prisma.payrollCycle.findFirst({ where: { orgId, isDefault: true } });
  if (existing) return existing;
  const any = await prisma.payrollCycle.findFirst({ where: { orgId } });
  if (any) return prisma.payrollCycle.update({ where: { id: any.id }, data: { isDefault: true } });
  return prisma.payrollCycle.create({ data: { orgId, name: 'Monthly', frequency: 'MONTHLY', isDefault: true } });
}

export async function listCycles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await ensureDefaultCycle(orgId);
    const cycles = await prisma.payrollCycle.findMany({ where: { orgId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], include: { _count: { select: { salaries: { where: { isActive: true } } } } } });
    const today = new Date();
    res.json(cycles.map(c => ({ ...c, currentPeriod: periodFor(c, today) })));
  } catch (err) { next(err); }
}

export async function saveCycle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = CycleSchema.parse(req.body);
    if ((data.frequency === 'WEEKLY' || data.frequency === 'BIWEEKLY') && data.startWeekday == null) throw new AppError(400, 'Weekly cycles need a start weekday');
    if (data.frequency === 'CUSTOM' && (!data.anchorDate || !data.lengthDays)) throw new AppError(400, 'Custom cycles need an anchor date and a length in days');
    const payload = { ...data, anchorDate: data.anchorDate ? parseDateOnly(data.anchorDate) : null };
    const id = req.params.id;
    if (data.isDefault) await prisma.payrollCycle.updateMany({ where: { orgId }, data: { isDefault: false } });
    const cycle = id
      ? await prisma.payrollCycle.update({ where: { id }, data: payload })
      : await prisma.payrollCycle.create({ data: { orgId, ...payload } });
    if (id && cycle.orgId !== orgId) throw new AppError(404, 'Cycle not found');
    logAction(req.user!.id, id ? 'UPDATE' : 'CREATE', 'PayrollCycle', cycle.id, data);
    res.json({ ...cycle, currentPeriod: periodFor(cycle, new Date()) });
  } catch (err) { next(err); }
}

// ─── Employee salaries ───────────────────────────────────────────────────────

const OverrideSchema = z.record(z.string(), z.object({
  amount: z.coerce.number().min(0).optional(),
  percent: z.coerce.number().min(0).max(1000).optional(),
  formula: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
}));

const EmployeeSalarySchema = z.object({
  userId: z.string(),
  payrollCycleId: z.string().nullable().optional(),
  currency: z.string().length(3).default('INR'),
  ctcAnnual: z.coerce.number().min(0).nullable().optional(),
  overrides: OverrideSchema.default({}),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).nullable().optional(),
});

const salaryInclude = {
  user: { select: { id: true, name: true, email: true, department: true, avatarUrl: true } },
  payrollCycle: { select: { id: true, name: true, frequency: true } },
};

/** Employee HR attributes the engine needs for applicability + PT state. */
export async function employeeContext(orgId: string, userId: string): Promise<EmployeeContext> {
  const emp = await prisma.employee.findFirst({
    where: { orgId, userId },
    select: { departmentId: true, locationId: true, designation: true, employmentType: true, state: true, location: { select: { state: true } } },
  });
  return {
    userId,
    departmentId: emp?.departmentId ?? null,
    locationId: emp?.locationId ?? null,
    designation: emp?.designation ?? null,
    employmentType: emp?.employmentType ?? null,
    state: emp?.location?.state ?? emp?.state ?? null,
  };
}

export async function listEmployeeSalaries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = await prisma.employeeSalary.findMany({ where: { orgId: req.user!.orgId, isActive: true }, include: salaryInclude, orderBy: { user: { name: 'asc' } } });
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getEmployeeSalary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const [current, history] = await Promise.all([
      prisma.employeeSalary.findFirst({ where: { orgId, userId: req.params.userId, isActive: true }, include: salaryInclude }),
      prisma.employeeSalary.findMany({ where: { orgId, userId: req.params.userId }, orderBy: { effectiveFrom: 'desc' }, take: 10, select: { id: true, effectiveFrom: true, isActive: true, notes: true, ctcAnnual: true } }),
    ]);
    res.json({ current, history });
  } catch (err) { next(err); }
}

/** POST /hr/payroll/employee-salaries — revise (deactivates the previous row) */
export async function upsertEmployeeSalary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = EmployeeSalarySchema.parse(req.body);
    const employee = await prisma.user.findFirst({ where: { id: data.userId, orgId, isActive: true } });
    if (!employee) throw new AppError(404, 'Employee not found');
    const comps = await prisma.salaryComponent.findMany({ where: { orgId }, select: { code: true } });
    for (const [code, o] of Object.entries(data.overrides)) {
      if (!comps.some(c => c.code === code)) throw new AppError(400, `Unknown component ${code}`);
      if (o.formula) assertValidFormula(o.formula, comps);
    }
    const cycleId = data.payrollCycleId ?? (await ensureDefaultCycle(orgId)).id;
    const [, row] = await prisma.$transaction([
      prisma.employeeSalary.updateMany({ where: { orgId, userId: data.userId, isActive: true }, data: { isActive: false } }),
      prisma.employeeSalary.create({
        data: { orgId, userId: data.userId, payrollCycleId: cycleId, currency: data.currency, ctcAnnual: data.ctcAnnual ?? null, overrides: data.overrides, effectiveFrom: parseDateOnly(data.effectiveFrom), notes: data.notes ?? null },
        include: salaryInclude,
      }),
    ]);
    logAction(req.user!.id, 'CREATE', 'EmployeeSalary', row.id, { userId: data.userId });
    res.status(201).json(row);
  } catch (err) { next(err); }
}

export async function deactivateEmployeeSalary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const row = await prisma.employeeSalary.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!row) throw new AppError(404, 'Not found');
    await prisma.employeeSalary.update({ where: { id: row.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

const PreviewSchema = z.object({
  userId: z.string().optional(),
  overrides: OverrideSchema.optional(),
  ctcAnnual: z.coerce.number().min(0).nullable().optional(),
  payrollCycleId: z.string().optional(),
  /** Any date inside the period to preview (default today) */
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Optional attendance figures to what-if (phase 2/3 fills these automatically) */
  /** false = ignore the attendance register and pay every calendar day */
  attendance: z.boolean().optional(),
  inputs: z.object({ workingDays: z.number().optional(), paidDays: z.number().optional(), lopDays: z.number().optional(), presentDays: z.number().optional(), leaveDays: z.number().optional(), halfDays: z.number().optional(), overtimeHours: z.number().optional() }).optional(),
});

/** POST /hr/payroll/preview — compute a payslip without saving anything. */
export async function previewPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const body = PreviewSchema.parse(req.body);
    await ensureDefaultComponents(orgId);
    const comps = await prisma.salaryComponent.findMany({ where: { orgId } });
    let overrides: Overrides = body.overrides ?? {};
    let ctc = body.ctcAnnual ?? null;
    let cycleId = body.payrollCycleId;
    if (body.userId && !body.overrides) {
      const es = await prisma.employeeSalary.findFirst({ where: { orgId, userId: body.userId, isActive: true } });
      if (es) { overrides = es.overrides as Overrides; ctc = ctc ?? (es.ctcAnnual ? Number(es.ctcAnnual) : null); cycleId = cycleId ?? es.payrollCycleId ?? undefined; }
    }
    const cycle = cycleId ? await prisma.payrollCycle.findFirst({ where: { id: cycleId, orgId } }) : await ensureDefaultCycle(orgId);
    const period = periodFor(cycle ?? { frequency: 'MONTHLY' }, body.on ? parseDateOnly(body.on) : new Date());
    let base = defaultPeriodInputs(period);
    let attendance: any = null;
    if (body.userId && body.attendance !== false) {
      const s = await payrollSummary(orgId, body.userId, period.start, period.end);
      base = inputsFromAttendance(period, s);
      attendance = { policyGroup: s.policyGroupName, byStatus: s.byStatus, lateCount: s.lateCount, lateConversion: s.lateConversion, futureDaysAssumedPaid: s.futureDaysAssumedPaid, manualCorrections: s.manualCorrections };
    }
    const inputs = { ...base, ...(body.inputs ?? {}) };
    if (body.inputs?.lopDays != null && body.inputs.paidDays == null) inputs.paidDays = inputs.workingDays - body.inputs.lopDays;
    const ctx = body.userId ? await employeeContext(orgId, body.userId) : { userId: 'preview' };
    const result = computePayslip(comps.map(toDef), overrides, ctx, inputs, ctc);
    res.json({ period, inputs, attendance, ...result });
  } catch (err) { next(err); }
}

export function toDef(c: any): ComponentDef {
  return {
    code: c.code, name: c.name, category: c.category, calcType: c.calcType,
    amount: c.amount != null ? Number(c.amount) : null, percent: c.percent != null ? Number(c.percent) : null,
    percentOf: c.percentOf, formula: c.formula, statutory: c.statutory, statutoryConfig: c.statutoryConfig,
    prorate: c.prorate, taxable: c.taxable, showOnPayslip: c.showOnPayslip, displayOrder: c.displayOrder, isActive: c.isActive,
    applicability: c.applicability,
  };
}
