// ─── Attendance register: DB glue around attendanceEngine ────────────────────
//
// computeDays() derives AttendanceDay rows for a user/range from check-in/out
// records, approved leave, holidays and the user's policy group, persisting
// COMPUTED rows and leaving MANUAL ones untouched. periodSummary() is what
// payroll calls.

import { prisma } from './prisma';
import {
  evaluateDay, summarise, pickGroup, DEFAULT_POLICY, DEFAULT_LATE_BANDS,
  type Policy, type DayStatus, type PeriodSummary, type Session,
} from './attendanceEngine';

const DAY = 86_400_000;
export const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
export const dateKey = (d: Date) => d.toISOString().slice(0, 10);
export const parseDateOnly = (s: string) => { const [y, m, d] = s.split('-').map(Number); return utcDate(y, m - 1, d); };

export function toPolicy(g: any, orgTz: string): Policy {
  return {
    id: g.id, shiftStart: g.shiftStart, shiftEnd: g.shiftEnd, timezone: g.timezone || orgTz || 'UTC',
    graceMinutes: g.graceMinutes, lateBands: g.lateBands ?? DEFAULT_LATE_BANDS,
    minFullDayMinutes: g.minFullDayMinutes, minHalfDayMinutes: g.minHalfDayMinutes,
    earlyDepartureGraceMinutes: g.earlyDepartureGraceMinutes, earlyDepartureStatus: g.earlyDepartureStatus,
    overtimeAfterMinutes: g.overtimeAfterMinutes, overtimeMinMinutes: g.overtimeMinMinutes,
    lateAllowedPerMonth: g.lateAllowedPerMonth, lateConversionEvery: g.lateConversionEvery, lateConversionUnit: g.lateConversionUnit,
    weeklyOffs: g.weeklyOffs ?? [0, 6], assumeShiftEndOnMissingCheckout: g.assumeShiftEndOnMissingCheckout,
  };
}

/** Every org gets a default 9–6 group. */
export async function ensureDefaultGroup(orgId: string) {
  const existing = await prisma.attendancePolicyGroup.findFirst({ where: { orgId, isDefault: true } });
  if (existing) return existing;
  const any = await prisma.attendancePolicyGroup.findFirst({ where: { orgId } });
  if (any) return prisma.attendancePolicyGroup.update({ where: { id: any.id }, data: { isDefault: true } });
  return prisma.attendancePolicyGroup.create({ data: { orgId, name: 'Standard (9:00 – 18:00)', isDefault: true, lateBands: DEFAULT_LATE_BANDS as any } });
}

async function employeeCtx(orgId: string, userId: string) {
  const emp = await prisma.employee.findFirst({ where: { orgId, userId }, select: { departmentId: true, locationId: true, employmentType: true } });
  return { userId, departmentId: emp?.departmentId ?? null, locationId: emp?.locationId ?? null, employmentType: emp?.employmentType ?? null };
}

export async function policyForUser(orgId: string, userId: string): Promise<{ policy: Policy; group: any; locationId: string | null }> {
  const [org, groups, ctx] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
    prisma.attendancePolicyGroup.findMany({ where: { orgId } }),
    employeeCtx(orgId, userId),
  ]);
  let group = pickGroup(groups, ctx);
  if (!group) group = await ensureDefaultGroup(orgId);
  return { policy: toPolicy(group, org?.timezone ?? 'UTC'), group, locationId: ctx.locationId };
}

/** Which calendar day a session belongs to: its own `date` column. */
export async function computeDays(orgId: string, userId: string, from: Date, to: Date, opts: { persist?: boolean } = { persist: true }) {
  const { policy, group, locationId } = await policyForUser(orgId, userId);
  const [records, leaves, holidays, manual] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { orgId, userId, date: { gte: from, lte: to } }, orderBy: { checkInAt: 'asc' } }),
    prisma.leaveRequest.findMany({ where: { orgId, userId, status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from } }, include: { leaveType: true } }),
    prisma.holiday.findMany({ where: { orgId, date: { gte: from, lte: to } } }),
    prisma.attendanceDay.findMany({ where: { orgId, userId, date: { gte: from, lte: to }, source: 'MANUAL' } }),
  ]);
  const manualByDate = new Map(manual.map(m => [dateKey(m.date), m]));
  const out: any[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const date = new Date(t); const key = dateKey(date);
    const existingManual = manualByDate.get(key);
    if (existingManual) { out.push(existingManual); continue; }
    const sessions: Session[] = records.filter(r => dateKey(r.date) === key).map(r => ({ checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, source: r.source }));
    const leave = leaves.find(l => l.startDate.getTime() <= t && l.endDate.getTime() >= t);
    const holiday = holidays.find(h => dateKey(h.date) === key && (h.locationIds.length === 0 || (locationId && h.locationIds.includes(locationId))));
    const wfh = records.some(r => dateKey(r.date) === key && r.notes?.toUpperCase().includes('WFH'));
    const res = evaluateDay(policy, {
      date, sessions, wfh,
      holiday: holiday ? { name: holiday.name, isOptional: holiday.isOptional } : null,
      leave: leave ? { days: Number(leave.days), halfDay: leave.halfDay, halfDayPeriod: leave.halfDayPeriod, isPaid: leave.leaveType.isPaid, leaveTypeName: leave.leaveType.name, requestId: leave.id } : null,
    });
    const row = {
      orgId, userId, date, status: res.status as any, source: 'COMPUTED', policyGroupId: group.id,
      firstInAt: res.firstInAt, lastOutAt: res.lastOutAt, workedMinutes: res.workedMinutes, lateMinutes: res.lateMinutes,
      earlyMinutes: res.earlyMinutes, overtimeMinutes: res.overtimeMinutes, paidFraction: res.paidFraction,
      leaveRequestId: res.leaveRequestId ?? null, reason: res.reason,
    };
    if (opts.persist) {
      const saved = await prisma.attendanceDay.upsert({ where: { userId_date: { userId, date } }, create: row, update: { ...row, notes: undefined, updatedBy: undefined } });
      out.push(saved);
    } else out.push(row);
  }
  return { days: out, policy, group };
}

export async function periodSummary(orgId: string, userId: string, from: Date, to: Date): Promise<PeriodSummary & { policyGroupName: string }> {
  const { days, policy, group } = await computeDays(orgId, userId, from, to);
  const s = summarise(policy, days.map(d => ({ status: d.status as DayStatus, paidFraction: Number(d.paidFraction), overtimeMinutes: d.overtimeMinutes })));
  return { ...s, policyGroupName: group.name };
}

/**
 * What payroll consumes. Days after today (a run started before the period
 * ends) have no punches yet, so they are assumed paid rather than absent; the
 * count is returned so the review screen can warn about it.
 */
export async function payrollSummary(orgId: string, userId: string, from: Date, to: Date, today = new Date()) {
  const { days, policy, group } = await computeDays(orgId, userId, from, to);
  const cutoff = parseDateOnly(dateKey(today));
  let futureDaysAssumedPaid = 0;
  const rows = days.map(d => {
    const future = d.date.getTime() > cutoff.getTime();
    if (future && d.source !== 'MANUAL' && d.status === 'ABSENT') { futureDaysAssumedPaid++; return { status: 'PRESENT' as DayStatus, paidFraction: 1, overtimeMinutes: 0 }; }
    return { status: d.status as DayStatus, paidFraction: Number(d.paidFraction), overtimeMinutes: d.overtimeMinutes };
  });
  const s = summarise(policy, rows);
  const manualCorrections = days.filter(d => d.source === 'MANUAL').length;
  return { ...s, policyGroupName: group.name, futureDaysAssumedPaid, manualCorrections };
}

export async function audit(orgId: string, changedBy: string, entry: { userId: string; date?: Date | null; entityType: string; entityId?: string | null; action: string; before?: any; after?: any; reason?: string | null }) {
  return prisma.attendanceAudit.create({ data: { orgId, changedBy, userId: entry.userId, date: entry.date ?? null, entityType: entry.entityType, entityId: entry.entityId ?? null, action: entry.action, before: entry.before ?? undefined, after: entry.after ?? undefined, reason: entry.reason ?? null } });
}

export { DEFAULT_POLICY };
