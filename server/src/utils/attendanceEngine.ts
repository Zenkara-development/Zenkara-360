// ─── Attendance policy engine ────────────────────────────────────────────────
//
// Pure functions (unit-testable) that turn an employee's raw check-in/out
// sessions for a day into a status + metrics under a policy group, plus the
// month-level late-arrival conversion and a period summary that payroll uses.
// Database access lives in attendanceRegister.ts.

export type DayStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'UNPAID_LEAVE' | 'WFH' | 'HOLIDAY' | 'WEEK_OFF' | 'LOP';

export interface LateBand { untilMinutes: number | null; status: 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' }

export interface Policy {
  id?: string;
  shiftStart: string;   // "HH:mm"
  shiftEnd: string;
  timezone: string;     // IANA
  graceMinutes: number;
  lateBands: LateBand[] | null | undefined;
  minFullDayMinutes: number;
  minHalfDayMinutes: number;
  earlyDepartureGraceMinutes: number;
  earlyDepartureStatus: string; // NONE | HALF_DAY
  overtimeAfterMinutes: number;
  overtimeMinMinutes: number;
  lateAllowedPerMonth: number;
  lateConversionEvery: number;
  lateConversionUnit: string;   // HALF_DAY | LOP | NONE
  weeklyOffs: number[];
  assumeShiftEndOnMissingCheckout: boolean;
}

export const DEFAULT_LATE_BANDS: LateBand[] = [
  { untilMinutes: 60, status: 'LATE' },
  { untilMinutes: 180, status: 'HALF_DAY' },
  { untilMinutes: null, status: 'ABSENT' },
];

export const DEFAULT_POLICY: Policy = {
  shiftStart: '09:00', shiftEnd: '18:00', timezone: 'UTC', graceMinutes: 15, lateBands: DEFAULT_LATE_BANDS,
  minFullDayMinutes: 480, minHalfDayMinutes: 240, earlyDepartureGraceMinutes: 15, earlyDepartureStatus: 'NONE',
  overtimeAfterMinutes: 0, overtimeMinMinutes: 30, lateAllowedPerMonth: 3, lateConversionEvery: 3, lateConversionUnit: 'HALF_DAY',
  weeklyOffs: [0, 6], assumeShiftEndOnMissingCheckout: false,
};

export interface Session { checkInAt: Date | null; checkOutAt: Date | null; source?: string }

export interface DayContext {
  date: Date;                 // UTC midnight of the calendar day
  sessions: Session[];
  holiday?: { name: string; isOptional: boolean } | null;
  leave?: { days: number; halfDay: boolean; halfDayPeriod: string | null; isPaid: boolean; leaveTypeName: string; requestId: string } | null;
  wfh?: boolean;
}

export interface DayResult {
  status: DayStatus;
  paidFraction: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  reason: string;
  leaveRequestId?: string | null;
}

// ─── Time helpers ────────────────────────────────────────────────────────────

/** Minutes since local midnight for an instant in a timezone. */
export function localMinutes(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** Local weekday (0 = Sunday) for a UTC-midnight calendar date. */
export function weekdayOf(date: Date): number { return date.getUTCDay(); }

export const hhmmToMinutes = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const minutesToHhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

function fmtDur(min: number) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`; }

// ─── Day evaluation ──────────────────────────────────────────────────────────

export function evaluateDay(policy: Policy, ctx: DayContext, now = new Date()): DayResult {
  const tz = policy.timezone || 'UTC';
  const base = { workedMinutes: 0, lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0, firstInAt: null as Date | null, lastOutAt: null as Date | null };
  const sessions = ctx.sessions.filter(s => s.checkInAt).sort((a, b) => a.checkInAt!.getTime() - b.checkInAt!.getTime());

  // Worked time across sessions (an open session counts up to now, capped at shift end + OT window)
  const shiftStartMin = hhmmToMinutes(policy.shiftStart), shiftEndMin = hhmmToMinutes(policy.shiftEnd);
  let worked = 0;
  for (const s of sessions) {
    let out = s.checkOutAt;
    if (!out) {
      const sameDay = now.getTime() - s.checkInAt!.getTime() < 20 * 3_600_000;
      if (sameDay) out = now;
      else if (policy.assumeShiftEndOnMissingCheckout) { // assume they left at shift end
        const inMin = localMinutes(s.checkInAt!, tz);
        out = new Date(s.checkInAt!.getTime() + Math.max(0, shiftEndMin - inMin) * 60_000);
      } else out = null;
    }
    if (out) worked += Math.max(0, Math.round((out.getTime() - s.checkInAt!.getTime()) / 60_000));
  }
  const firstIn = sessions[0]?.checkInAt ?? null;
  const lastOut = sessions.length ? (sessions[sessions.length - 1].checkOutAt ?? null) : null;
  const metrics = { ...base, workedMinutes: worked, firstInAt: firstIn, lastOutAt: lastOut };

  // 1. Non-working days first — work on them is still recorded (OT-eligible in a later phase)
  const isWeekOff = policy.weeklyOffs.includes(weekdayOf(ctx.date));
  if (ctx.holiday && !ctx.holiday.isOptional) return { status: 'HOLIDAY', paidFraction: 1, ...metrics, reason: ctx.holiday.name };
  if (isWeekOff) return { status: 'WEEK_OFF', paidFraction: 1, ...metrics, reason: 'Weekly off' };

  // 2. Full-day leave wins over whatever was punched
  if (ctx.leave && !ctx.leave.halfDay) {
    return ctx.leave.isPaid
      ? { status: 'LEAVE', paidFraction: 1, ...metrics, reason: ctx.leave.leaveTypeName, leaveRequestId: ctx.leave.requestId }
      : { status: 'UNPAID_LEAVE', paidFraction: 0, ...metrics, reason: `${ctx.leave.leaveTypeName} (unpaid)`, leaveRequestId: ctx.leave.requestId };
  }

  // 3. No punches at all
  if (sessions.length === 0) {
    if (ctx.wfh) return { status: 'WFH', paidFraction: 1, ...metrics, reason: 'Work from home' };
    if (ctx.leave?.halfDay) {
      return { status: 'HALF_DAY', paidFraction: ctx.leave.isPaid ? 1 : 0.5, ...metrics, reason: `Half-day ${ctx.leave.leaveTypeName}, no attendance for the other half`, leaveRequestId: ctx.leave.requestId };
    }
    return { status: 'ABSENT', paidFraction: 0, ...metrics, reason: 'No check-in' };
  }

  // 4. Arrival band
  const inMin = localMinutes(firstIn!, tz);
  const lateBy = Math.max(0, inMin - shiftStartMin);
  const lateMinutes = lateBy > policy.graceMinutes ? lateBy : 0;
  let arrival: DayStatus = 'PRESENT';
  if (lateMinutes > 0) {
    const bands = (policy.lateBands && policy.lateBands.length ? policy.lateBands : DEFAULT_LATE_BANDS);
    const band = bands.find(b => b.untilMinutes == null || lateBy <= b.untilMinutes) ?? bands[bands.length - 1];
    arrival = band.status;
  }

  // 5. Worked-hours rule (only when a check-out exists or open session is still today)
  const haveOut = !!lastOut || sessions.some(s => !s.checkOutAt && now.getTime() - s.checkInAt!.getTime() < 20 * 3_600_000);
  const halfLeave = ctx.leave?.halfDay ? ctx.leave : null;
  const requiredFull = halfLeave ? Math.round(policy.minFullDayMinutes / 2) : policy.minFullDayMinutes;
  const requiredHalf = halfLeave ? Math.round(policy.minHalfDayMinutes / 2) : policy.minHalfDayMinutes;

  // Early departure
  let earlyMinutes = 0;
  if (lastOut) {
    const outMin = localMinutes(lastOut, tz);
    const earlyBy = Math.max(0, shiftEndMin - outMin);
    if (earlyBy > policy.earlyDepartureGraceMinutes && !(halfLeave && halfLeave.halfDayPeriod === 'PM')) earlyMinutes = earlyBy;
  }
  // Overtime
  let overtimeMinutes = 0;
  if (policy.overtimeAfterMinutes > 0 && lastOut) {
    const outMin = localMinutes(lastOut, tz);
    const beyond = outMin - shiftEndMin - policy.overtimeAfterMinutes;
    if (beyond >= policy.overtimeMinMinutes) overtimeMinutes = beyond;
  }

  let status: DayStatus;
  let reason: string;
  if (!haveOut && !policy.assumeShiftEndOnMissingCheckout) {
    status = 'ABSENT'; reason = 'Checked in but never checked out';
  } else if (worked >= requiredFull) {
    status = arrival; reason = arrival === 'PRESENT' ? `Worked ${fmtDur(worked)}` : `Arrived ${fmtDur(lateBy)} late (${arrival.toLowerCase().replace('_', ' ')} band)`;
  } else if (worked >= requiredHalf) {
    status = arrival === 'ABSENT' ? 'ABSENT' : 'HALF_DAY';
    reason = `Worked ${fmtDur(worked)} < ${fmtDur(requiredFull)} full-day minimum`;
  } else {
    status = 'ABSENT'; reason = `Worked ${fmtDur(worked)} < ${fmtDur(requiredHalf)} half-day minimum`;
  }
  if (status !== 'ABSENT' && earlyMinutes > 0 && policy.earlyDepartureStatus === 'HALF_DAY' && status !== 'HALF_DAY') {
    status = 'HALF_DAY'; reason = `Left ${fmtDur(earlyMinutes)} early`;
  }
  if (halfLeave && status === 'PRESENT') reason = `Half-day ${halfLeave.leaveTypeName} + ${fmtDur(worked)} worked`;

  const paidFraction = status === 'ABSENT' ? (halfLeave?.isPaid ? 0.5 : 0) : status === 'HALF_DAY' ? (halfLeave ? (halfLeave.isPaid ? 1 : 0.5) : 0.5) : 1;
  return { status, paidFraction, ...metrics, lateMinutes, earlyMinutes, overtimeMinutes, reason, leaveRequestId: halfLeave?.requestId ?? null };
}

// ─── Month-level late conversion ─────────────────────────────────────────────

export interface Conversion { count: number; unit: string; extraLopDays: number; halfDaysConverted: number; note: string }

/** Lates beyond the monthly allowance convert into half days / LOP. Returns the deduction to apply on top of day statuses. */
export function lateConversion(policy: Policy, lateCount: number): Conversion {
  const extra = Math.max(0, lateCount - policy.lateAllowedPerMonth);
  const every = Math.max(1, policy.lateConversionEvery);
  const units = policy.lateConversionUnit === 'NONE' ? 0 : Math.floor(extra / every);
  if (units === 0) return { count: lateCount, unit: policy.lateConversionUnit, extraLopDays: 0, halfDaysConverted: 0, note: lateCount ? `${lateCount} late arrival${lateCount === 1 ? '' : 's'} (${policy.lateAllowedPerMonth} allowed)` : '' };
  const lop = policy.lateConversionUnit === 'LOP' ? units : units * 0.5;
  return { count: lateCount, unit: policy.lateConversionUnit, extraLopDays: lop, halfDaysConverted: policy.lateConversionUnit === 'HALF_DAY' ? units : 0,
    note: `${lateCount} late arrivals; ${extra} over the ${policy.lateAllowedPerMonth} allowed → ${units} ${policy.lateConversionUnit === 'LOP' ? 'LOP day' : 'half day'}${units === 1 ? '' : 's'}` };
}

// ─── Period summary (what payroll consumes) ──────────────────────────────────

export interface PeriodSummary {
  daysInPeriod: number;
  workingDays: number;      // period days − week offs − holidays
  presentDays: number;      // full-day presence incl. late, WFH
  halfDays: number;
  leaveDays: number;        // paid leave
  unpaidLeaveDays: number;
  absentDays: number;
  lopDays: number;          // unpaid days + late conversion (what payroll deducts)
  paidDays: number;         // workingDays − lopDays
  lateCount: number;
  lateConversion: Conversion;
  overtimeHours: number;
  byStatus: Record<string, number>;
}

export function summarise(policy: Policy, days: { status: DayStatus; paidFraction: number; overtimeMinutes: number }[]): PeriodSummary {
  const byStatus: Record<string, number> = {};
  for (const d of days) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  const nonWorking = (byStatus.HOLIDAY ?? 0) + (byStatus.WEEK_OFF ?? 0);
  const workingDays = days.length - nonWorking;
  const lateCount = byStatus.LATE ?? 0;
  const conv = lateConversion(policy, lateCount);
  const paidFromDays = days.filter(d => d.status !== 'HOLIDAY' && d.status !== 'WEEK_OFF').reduce((s, d) => s + d.paidFraction, 0);
  const lopFromDays = Math.round((workingDays - paidFromDays) * 100) / 100;
  const lopDays = Math.min(workingDays, Math.round((lopFromDays + conv.extraLopDays) * 100) / 100);
  return {
    daysInPeriod: days.length, workingDays,
    presentDays: (byStatus.PRESENT ?? 0) + (byStatus.LATE ?? 0) + (byStatus.WFH ?? 0),
    halfDays: byStatus.HALF_DAY ?? 0,
    leaveDays: byStatus.LEAVE ?? 0, unpaidLeaveDays: byStatus.UNPAID_LEAVE ?? 0, absentDays: byStatus.ABSENT ?? 0,
    lopDays, paidDays: Math.max(0, Math.round((workingDays - lopDays) * 100) / 100),
    lateCount, lateConversion: conv,
    overtimeHours: Math.round(days.reduce((s, d) => s + d.overtimeMinutes, 0) / 60 * 100) / 100,
    byStatus,
  };
}

// ─── Applicability ───────────────────────────────────────────────────────────

export interface GroupLike { id: string; isDefault: boolean; isActive: boolean; applicability?: any }
export interface EmpCtx { userId: string; departmentId?: string | null; locationId?: string | null; employmentType?: string | null }

/** Most specific active group wins: explicit user > location > department > employment type > default. */
export function pickGroup<T extends GroupLike>(groups: T[], e: EmpCtx): T | null {
  const active = groups.filter(g => g.isActive);
  const has = (l?: string[]) => Array.isArray(l) && l.length > 0;
  const byUser = active.find(g => has(g.applicability?.userIds) && g.applicability.userIds.includes(e.userId));
  if (byUser) return byUser;
  const byLoc = active.find(g => has(g.applicability?.locationIds) && e.locationId && g.applicability.locationIds.includes(e.locationId));
  if (byLoc) return byLoc;
  const byDept = active.find(g => has(g.applicability?.departmentIds) && e.departmentId && g.applicability.departmentIds.includes(e.departmentId));
  if (byDept) return byDept;
  const byType = active.find(g => has(g.applicability?.employmentTypes) && e.employmentType && g.applicability.employmentTypes.includes(e.employmentType));
  if (byType) return byType;
  return active.find(g => g.isDefault) ?? active.find(g => !g.applicability || Object.values(g.applicability).every((v: any) => !has(v))) ?? null;
}
