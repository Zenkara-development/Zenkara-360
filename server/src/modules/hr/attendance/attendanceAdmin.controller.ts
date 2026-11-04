// Attendance policy groups, holidays, the day register and admin corrections.
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import { sseManager, SSEEvent } from '../../../utils/sse';
import { computeDays, periodSummary, ensureDefaultGroup, audit, parseDateOnly, dateKey, policyForUser } from '../../../utils/attendanceRegister';
import { DEFAULT_LATE_BANDS } from '../../../utils/attendanceEngine';

const MANAGER_ROLES = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ─── Policy groups ───────────────────────────────────────────────────────────

const GroupSchema = z.object({
  name: z.string().min(1).max(80),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  shiftStart: z.string().regex(HHMM).optional(),
  shiftEnd: z.string().regex(HHMM).optional(),
  timezone: z.string().nullable().optional(),
  graceMinutes: z.coerce.number().int().min(0).max(240).optional(),
  lateBands: z.array(z.object({ untilMinutes: z.number().int().min(1).nullable(), status: z.enum(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT']) })).min(1).max(6).optional(),
  minFullDayMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  minHalfDayMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  earlyDepartureGraceMinutes: z.coerce.number().int().min(0).max(240).optional(),
  earlyDepartureStatus: z.enum(['NONE', 'HALF_DAY']).optional(),
  overtimeAfterMinutes: z.coerce.number().int().min(0).max(240).optional(),
  overtimeMinMinutes: z.coerce.number().int().min(0).max(480).optional(),
  lateAllowedPerMonth: z.coerce.number().int().min(0).max(31).optional(),
  lateConversionEvery: z.coerce.number().int().min(1).max(31).optional(),
  lateConversionUnit: z.enum(['HALF_DAY', 'LOP', 'NONE']).optional(),
  weeklyOffs: z.array(z.number().int().min(0).max(6)).optional(),
  assumeShiftEndOnMissingCheckout: z.boolean().optional(),
  applicability: z.object({ departmentIds: z.array(z.string()).optional(), locationIds: z.array(z.string()).optional(), employmentTypes: z.array(z.string()).optional(), userIds: z.array(z.string()).optional() }).nullable().optional(),
});

export async function listGroups(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await ensureDefaultGroup(orgId);
    const groups = await prisma.attendancePolicyGroup.findMany({ where: { orgId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    res.json({ groups, defaultLateBands: DEFAULT_LATE_BANDS });
  } catch (err) { next(err); }
}

export async function saveGroup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = GroupSchema.parse(req.body);
    if (data.lateBands) {
      const ordered = data.lateBands.every((b, i) => i === data.lateBands!.length - 1 ? true : b.untilMinutes != null && (i === 0 || b.untilMinutes > (data.lateBands![i - 1].untilMinutes ?? 0)));
      if (!ordered || data.lateBands[data.lateBands.length - 1].untilMinutes !== null) throw new AppError(400, 'Late bands must be in increasing order and the last band must be "and after"');
    }
    const id = req.params.id;
    if (data.isDefault) await prisma.attendancePolicyGroup.updateMany({ where: { orgId }, data: { isDefault: false } });
    const payload: any = { ...data, applicability: data.applicability === null ? undefined : data.applicability };
    const group = id
      ? await prisma.attendancePolicyGroup.update({ where: { id }, data: payload })
      : await prisma.attendancePolicyGroup.create({ data: { orgId, ...payload } });
    if (group.orgId !== orgId) throw new AppError(404, 'Policy group not found');
    logAction(req.user!.id, id ? 'UPDATE' : 'CREATE', 'AttendancePolicyGroup', group.id, data);
    res.json(group);
  } catch (err) { next(err); }
}

export async function deleteGroup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const g = await prisma.attendancePolicyGroup.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!g) throw new AppError(404, 'Policy group not found');
    if (g.isDefault) throw new AppError(400, 'Make another group the default first');
    await prisma.attendancePolicyGroup.update({ where: { id: g.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** GET /hr/attendance/policy-groups/mine — the caller's effective policy (for the Attendance page hints) */
export async function myPolicy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { policy, group } = await policyForUser(req.user!.orgId, req.user!.id);
    res.json({ ...policy, groupName: group.name });
  } catch (err) { next(err); }
}

// ─── Holidays ────────────────────────────────────────────────────────────────

const HolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(80),
  locationIds: z.array(z.string()).optional(),
  isOptional: z.boolean().optional(),
});

export async function listHolidays(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const rows = await prisma.holiday.findMany({ where: { orgId: req.user!.orgId, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { date: 'asc' } });
    res.json(rows);
  } catch (err) { next(err); }
}

export async function saveHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = HolidaySchema.parse(req.body);
    const payload = { date: parseDateOnly(data.date), name: data.name, locationIds: data.locationIds ?? [], isOptional: data.isOptional ?? false };
    const h = req.params.id
      ? await prisma.holiday.update({ where: { id: req.params.id }, data: payload })
      : await prisma.holiday.create({ data: { orgId, ...payload } });
    if (h.orgId !== orgId) throw new AppError(404, 'Holiday not found');
    res.json(h);
  } catch (err) { next(err); }
}

export async function deleteHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const h = await prisma.holiday.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!h) throw new AppError(404, 'Holiday not found');
    await prisma.holiday.delete({ where: { id: h.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** POST /hr/attendance/holidays/bulk — [{date,name}] */
export async function bulkHolidays(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = z.array(HolidaySchema).min(1).max(100).parse(req.body);
    const orgId = req.user!.orgId;
    await prisma.holiday.createMany({ data: rows.map(r => ({ orgId, date: parseDateOnly(r.date), name: r.name, locationIds: r.locationIds ?? [], isOptional: r.isOptional ?? false })), skipDuplicates: true });
    res.json({ ok: true, count: rows.length });
  } catch (err) { next(err); }
}

// ─── Register (days) ─────────────────────────────────────────────────────────

function rangeFromQuery(q: Record<string, string>) {
  if (q.from && q.to) return { from: parseDateOnly(q.from), to: parseDateOnly(q.to) };
  const [y, m] = (q.month || new Date().toISOString().slice(0, 7)).split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

/** GET /hr/attendance/register?month=YYYY-MM[&userId=] — managers: everyone (or one user); others: self */
export async function register(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const isManager = MANAGER_ROLES.includes(req.user!.role);
    const q = req.query as Record<string, string>;
    const { from, to } = rangeFromQuery(q);
    if (to.getTime() - from.getTime() > 62 * 86_400_000) throw new AppError(400, 'Range too large (max 62 days)');
    const users = isManager && !q.userId
      ? await prisma.user.findMany({ where: { orgId, isActive: true, role: { not: 'EMPLOYEE' } }, select: { id: true, name: true, avatarUrl: true, department: true }, orderBy: { name: 'asc' } })
      : await prisma.user.findMany({ where: { orgId, id: isManager && q.userId ? q.userId : req.user!.id }, select: { id: true, name: true, avatarUrl: true, department: true } });
    const includeEmployees = isManager && !q.userId && q.includeEmployees === '1';
    const list = includeEmployees ? await prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true, avatarUrl: true, department: true }, orderBy: { name: 'asc' } }) : users;
    const rows = [];
    for (const u of list) {
      const { days, group } = await computeDays(orgId, u.id, from, to);
      const summary = await periodSummary(orgId, u.id, from, to);
      rows.push({ user: u, policyGroup: group.name, days: days.map(d => ({ date: dateKey(d.date), status: d.status, source: d.source, paidFraction: Number(d.paidFraction), workedMinutes: d.workedMinutes, lateMinutes: d.lateMinutes, earlyMinutes: d.earlyMinutes, overtimeMinutes: d.overtimeMinutes, firstInAt: d.firstInAt, lastOutAt: d.lastOutAt, reason: d.reason, notes: d.notes, leaveRequestId: d.leaveRequestId })), summary });
    }
    res.json({ from: dateKey(from), to: dateKey(to), rows });
  } catch (err) { next(err); }
}

/** GET /hr/attendance/summary?userId&from&to — period figures for one user (payroll uses the same function) */
export async function summary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    const { from, to } = rangeFromQuery(q);
    const userId = MANAGER_ROLES.includes(req.user!.role) && q.userId ? q.userId : req.user!.id;
    res.json(await periodSummary(req.user!.orgId, userId, from, to));
  } catch (err) { next(err); }
}

// ─── Admin corrections ───────────────────────────────────────────────────────

const MarkSchema = z.object({
  userId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'UNPAID_LEAVE', 'WFH', 'HOLIDAY', 'WEEK_OFF', 'LOP']),
  /** Optional new punch times (ISO). Applied to the day's first/last record or a MANUAL record is created. */
  checkInAt: z.string().datetime().nullable().optional(),
  checkOutAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
});

const PAID: Record<string, number> = { PRESENT: 1, LATE: 1, WFH: 1, LEAVE: 1, HOLIDAY: 1, WEEK_OFF: 1, HALF_DAY: 0.5, ABSENT: 0, UNPAID_LEAVE: 0, LOP: 0 };

/** POST /hr/attendance/days — mark, correct or regularise one day (managers). Audited. */
export async function markDay(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = MarkSchema.parse(req.body);
    const target = await prisma.user.findFirst({ where: { id: data.userId, orgId } });
    if (!target) throw new AppError(404, 'User not found');
    const date = parseDateOnly(data.date);

    // Make sure a computed row exists so "before" is meaningful
    await computeDays(orgId, data.userId, date, date);
    const before = await prisma.attendanceDay.findUnique({ where: { userId_date: { userId: data.userId, date } } });

    // Optional time edits → attendance record
    if (data.checkInAt !== undefined || data.checkOutAt !== undefined) {
      const rec = await prisma.attendanceRecord.findFirst({ where: { orgId, userId: data.userId, date }, orderBy: { checkInAt: 'asc' } });
      const recBefore = rec ? { checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt } : null;
      const times = { ...(data.checkInAt !== undefined ? { checkInAt: data.checkInAt ? new Date(data.checkInAt) : null } : {}), ...(data.checkOutAt !== undefined ? { checkOutAt: data.checkOutAt ? new Date(data.checkOutAt) : null } : {}) };
      const saved = rec
        ? await prisma.attendanceRecord.update({ where: { id: rec.id }, data: { ...times, notes: data.notes ?? rec.notes } })
        : await prisma.attendanceRecord.create({ data: { orgId, userId: data.userId, date, source: 'MANUAL', notes: data.notes, checkInAt: times.checkInAt ?? null, checkOutAt: times.checkOutAt ?? null } });
      await audit(orgId, req.user!.id, { userId: data.userId, date, entityType: 'ATTENDANCE_RECORD', entityId: saved.id, action: 'TIME_EDIT', before: recBefore, after: { checkInAt: saved.checkInAt, checkOutAt: saved.checkOutAt }, reason: data.reason });
    }

    const action = !before || before.status === 'ABSENT' ? 'REGULARISE' : before.source === 'MANUAL' ? 'CORRECT' : 'MARK';
    const after = await prisma.attendanceDay.upsert({
      where: { userId_date: { userId: data.userId, date } },
      create: { orgId, userId: data.userId, date, status: data.status, source: 'MANUAL', paidFraction: PAID[data.status], notes: data.notes, reason: `Set by ${req.user!.email}`, updatedBy: req.user!.id },
      update: { status: data.status, source: 'MANUAL', paidFraction: PAID[data.status], notes: data.notes, reason: `Set by ${req.user!.email}: ${data.reason}`, updatedBy: req.user!.id },
    });
    await audit(orgId, req.user!.id, { userId: data.userId, date, entityType: 'ATTENDANCE_DAY', entityId: after.id, action, before: before ? { status: before.status, source: before.source, paidFraction: before.paidFraction, notes: before.notes } : null, after: { status: after.status, source: 'MANUAL', paidFraction: after.paidFraction, notes: after.notes }, reason: data.reason });
    logAction(req.user!.id, 'UPDATE', 'AttendanceDay', after.id, { action, userId: data.userId, date: data.date, status: data.status });
    sseManager.broadcastAll(orgId, SSEEvent.ATTENDANCE_UPDATED, { userId: data.userId, type: 'corrected' });
    res.json(after);
  } catch (err) { next(err); }
}

/** DELETE /hr/attendance/days/:userId/:date — drop a manual override so the engine recomputes the day */
export async function resetDay(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const date = parseDateOnly(req.params.date);
    const before = await prisma.attendanceDay.findFirst({ where: { orgId, userId: req.params.userId, date, source: 'MANUAL' } });
    if (!before) throw new AppError(404, 'No manual entry for that day');
    await prisma.attendanceDay.delete({ where: { id: before.id } });
    const { days } = await computeDays(orgId, req.params.userId, date, date);
    await audit(orgId, req.user!.id, { userId: req.params.userId, date, entityType: 'ATTENDANCE_DAY', entityId: days[0]?.id, action: 'CORRECT', before: { status: before.status, source: 'MANUAL' }, after: { status: days[0]?.status, source: 'COMPUTED' }, reason: (req.body?.reason as string) || 'Reverted to computed' });
    res.json(days[0]);
  } catch (err) { next(err); }
}

/** GET /hr/attendance/audit?userId=&limit= — modification history (managers; employees see their own) */
export async function auditHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    const isManager = MANAGER_ROLES.includes(req.user!.role);
    const userId = isManager ? q.userId : req.user!.id;
    const rows = await prisma.attendanceAudit.findMany({
      where: { orgId: req.user!.orgId, ...(userId ? { userId } : {}) },
      include: { changer: { select: { id: true, name: true } }, user: { select: { id: true, name: true } } },
      orderBy: { changedAt: 'desc' }, take: Math.min(200, Number(q.limit) || 50),
    });
    res.json(rows);
  } catch (err) { next(err); }
}
