import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { runWorkflows } from '../../../utils/workflow-engine';
import { sendMail, emailTemplates } from '../../../utils/mailer';
import { sseManager, SSEEvent } from '../../../utils/sse';
import { notifyOrgAdmins } from '../../notifications/notifications.controller';
import { logAction } from '../../../utils/auditLog';

const fmt = (d: Date) => d.toISOString().slice(0, 10);

// ─── Leave Types ─────────────────────────────────────────────────────────────

const LeaveTypeSchema = z.object({
  name: z.string().min(1),
  annualQuota: z.number().int().min(0).max(365).default(12),
  isPaid: z.boolean().default(true),
  color: z.string().optional(),
  isActive: z.boolean().optional(),
  carryForward: z.boolean().optional(),
  carryForwardMaxDays: z.number().int().min(0).max(365).optional(),
  carryForwardExpiryMonths: z.number().int().min(0).max(12).optional(),
  allowHalfDay: z.boolean().optional(),
  isUnlimited: z.boolean().optional(),
});
import { audit, parseDateOnly as parseD, computeDays } from '../../../utils/attendanceRegister';

const MANAGER_ROLES = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'];

export async function listLeaveTypes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.query.all !== '1';
    const types = await prisma.leaveType.findMany({
      where: { orgId: req.user!.orgId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: { name: 'asc' },
    });
    res.json(types);
  } catch (err) { next(err); }
}

export async function createLeaveType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = LeaveTypeSchema.parse(req.body);
    const type = await prisma.leaveType.create({ data: { ...data, orgId: req.user!.orgId } });
    res.status(201).json(type);
  } catch (err) { next(err); }
}

export async function updateLeaveType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = LeaveTypeSchema.partial().parse(req.body);
    const existing = await prisma.leaveType.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Leave type not found');
    const type = await prisma.leaveType.update({ where: { id: req.params.id }, data });
    res.json(type);
  } catch (err) { next(err); }
}

export async function deleteLeaveType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Soft-delete (isActive: false) rather than a hard delete — existing
    // LeaveRequests reference this row (RESTRICT on delete), and keeping
    // history intact matters more here than freeing up the name.
    const existing = await prisma.leaveType.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Leave type not found');
    await prisma.leaveType.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Leave type deactivated' });
  } catch (err) { next(err); }
}

// ─── Balance ──────────────────────────────────────────────────────────────────

/**
 * Balance per leave type for a user in a year:
 *   opening (carry-forward from last year, capped, lapsing after N months) + quota + adjustments − used (approved, incl. half days)
 */
export async function computeBalances(orgId: string, userId: string, year: number, asOf = new Date()) {
  const yearStart = new Date(Date.UTC(year, 0, 1)), yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const prevStart = new Date(Date.UTC(year - 1, 0, 1));
  const [types, approved, adjustments, prevAdjustments] = await Promise.all([
    prisma.leaveType.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.leaveRequest.findMany({ where: { orgId, userId, status: 'APPROVED', startDate: { gte: prevStart, lt: yearEnd } } }),
    prisma.leaveBalanceAdjustment.findMany({ where: { orgId, userId, year } }),
    prisma.leaveBalanceAdjustment.findMany({ where: { orgId, userId, year: year - 1 } }),
  ]);
  const usedIn = (typeId: string, y: number) => approved.filter(r => r.leaveTypeId === typeId && r.startDate.getUTCFullYear() === y).reduce((s, r) => s + Number(r.days), 0);
  const adj = (list: typeof adjustments, typeId: string) => list.filter(a => a.leaveTypeId === typeId).reduce((s, a) => s + Number(a.days), 0);
  return types.map(t => {
    let carried = 0;
    if (t.carryForward) {
      const prevRemaining = Math.max(0, t.annualQuota + adj(prevAdjustments, t.id) - usedIn(t.id, year - 1));
      carried = Math.min(prevRemaining, t.carryForwardMaxDays || prevRemaining);
      if (t.carryForwardExpiryMonths > 0 && asOf >= new Date(Date.UTC(year, t.carryForwardExpiryMonths, 1))) {
        // Expired: only the part already consumed this year counts (consumed first-in-first-out)
        carried = Math.min(carried, usedIn(t.id, year));
      }
    }
    const used = usedIn(t.id, year);
    const adjustments_ = adj(adjustments, t.id);
    const entitlement = t.annualQuota + carried + adjustments_;
    return { leaveType: t, quota: t.annualQuota, carriedForward: carried, adjustments: adjustments_, used, remaining: t.isUnlimited ? null : Math.max(0, Math.round((entitlement - used) * 10) / 10), entitlement };
  });
}

/** GET /hr/leave/balance[?userId=&year=] — own balances; managers may query anyone */
export async function myBalance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const isManager = MANAGER_ROLES.includes(req.user!.role);
    const userId = isManager && typeof req.query.userId === 'string' ? req.query.userId : req.user!.id;
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    res.json(await computeBalances(req.user!.orgId, userId, year));
  } catch (err) { next(err); }
}

const AdjustSchema = z.object({ userId: z.string(), leaveTypeId: z.string(), year: z.number().int().min(2000).max(2100), days: z.number().min(-365).max(365), reason: z.string().min(1) });

/** POST /hr/leave/balances/adjust — managers credit/debit a balance (opening balance, comp-off, correction). Audited. */
export async function adjustBalance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = AdjustSchema.parse(req.body);
    const [user, type] = await Promise.all([prisma.user.findFirst({ where: { id: data.userId, orgId } }), prisma.leaveType.findFirst({ where: { id: data.leaveTypeId, orgId } })]);
    if (!user || !type) throw new AppError(404, 'User or leave type not found');
    const row = await prisma.leaveBalanceAdjustment.create({ data: { orgId, userId: data.userId, leaveTypeId: data.leaveTypeId, year: data.year, days: data.days, reason: data.reason, createdBy: req.user!.id } });
    await audit(orgId, req.user!.id, { userId: data.userId, entityType: 'LEAVE_BALANCE', entityId: row.id, action: 'BALANCE_ADJUST', after: { leaveType: type.name, year: data.year, days: data.days }, reason: data.reason });
    res.status(201).json(row);
  } catch (err) { next(err); }
}

// ─── Requests ────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  leaveTypeId: z.string(),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
  reason: z.string().optional(),
  halfDay: z.boolean().optional(),
  halfDayPeriod: z.enum(['AM', 'PM']).optional(),
});

function leaveDays(startDate: Date, endDate: Date, halfDay: boolean) {
  const whole = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  return halfDay ? 0.5 : whole;
}

const include = {
  leaveType: true,
  user: { select: { id: true, name: true, avatarUrl: true } },
  decider: { select: { id: true, name: true } },
};

function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function createRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = RequestSchema.parse(req.body);
    const orgId = req.user!.orgId;
    const userId = req.user!.id;

    const leaveType = await prisma.leaveType.findFirst({ where: { id: data.leaveTypeId, orgId, isActive: true } });
    if (!leaveType) throw new AppError(404, 'Leave type not found');

    const startDate = parseDateOnly(data.startDate);
    const endDate = data.halfDay ? startDate : parseDateOnly(data.endDate);
    if (endDate < startDate) throw new AppError(400, 'End date must be on or after the start date');
    if (data.halfDay && !leaveType.allowHalfDay) throw new AppError(400, `${leaveType.name} cannot be taken as a half day`);
    const days = leaveDays(startDate, endDate, !!data.halfDay);
    const overlap = await prisma.leaveRequest.findFirst({ where: { orgId, userId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
    if (overlap) throw new AppError(400, 'You already have leave on those dates');

    const request = await prisma.leaveRequest.create({
      data: { orgId, userId, leaveTypeId: data.leaveTypeId, startDate, endDate, days, halfDay: !!data.halfDay, halfDayPeriod: data.halfDay ? (data.halfDayPeriod ?? 'AM') : null, reason: data.reason },
      include,
    });

    logAction(userId, 'CREATE', 'LeaveRequest', request.id, { leaveType: leaveType.name, days });
    sseManager.broadcastAll(orgId, SSEEvent.LEAVE_UPDATED, { id: request.id, userId, type: 'created' });
    notifyOrgAdmins({
      orgId, type: 'LEAVE_REQUESTED', title: `${request.user.name} requested ${leaveType.name}`,
      body: `${fmt(startDate)} → ${fmt(endDate)} (${Number(days)} day${days === 1 ? '' : 's'})`,
      entityType: 'LEAVE_REQUEST', entityId: request.id,
    }).catch(() => {});

    const managers = await prisma.user.findMany({ where: { orgId, role: { in: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] }, isActive: true } });
    managers.forEach(m => sendMail({
      ...emailTemplates.leaveRequested(m.email, m.name, request.user.name, leaveType.name, fmt(startDate), fmt(endDate), days),
      orgId,
    }).catch(() => {}));

    /* Automation hook — e.g. "when anyone requests more than 5 days,
       notify HR ops" (condition: days gt 5) or webhook a payroll system. */
    runWorkflows({
      trigger: 'LEAVE_REQUESTED', orgId, entityType: 'LEAVE', entityId: request.id,
      entity: { ...(request as any), leaveType: leaveType.name, employeeName: (request as any).user?.name },
    }).catch(() => {});

    res.status(201).json(request);
  } catch (err) { next(err); }
}

/** GET /hr/leave/requests — self sees own; managers can pass ?scope=org to see everyone's (else defaults to their own too) */
export async function listRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { status, userId, scope } = req.query as Record<string, string>;
    const isManager = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'].includes(req.user!.role);

    const where: any = { orgId };
    if (isManager && scope === 'org') {
      if (userId) where.userId = userId;
    } else {
      where.userId = req.user!.id;
    }
    if (status) where.status = status;

    const requests = await prisma.leaveRequest.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    res.json(requests);
  } catch (err) { next(err); }
}

export async function cancelRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const request = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!request) throw new AppError(404, 'Leave request not found');
    if (request.userId !== req.user!.id) throw new AppError(403, 'You can only cancel your own request');
    if (request.status !== 'PENDING') throw new AppError(400, 'Only a pending request can be cancelled');

    const updated = await prisma.leaveRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED' }, include });
    logAction(req.user!.id, 'UPDATE', 'LeaveRequest', request.id, { action: 'cancelled' });
    res.json(updated);
  } catch (err) { next(err); }
}

const RejectSchema = z.object({ reason: z.string().min(1) });

async function decide(req: AuthRequest, res: Response, next: NextFunction, approve: boolean) {
  try {
    const orgId = req.user!.orgId;
    const request = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, orgId }, include });
    if (!request) throw new AppError(404, 'Leave request not found');
    if (request.status !== 'PENDING') throw new AppError(400, `This request is already ${request.status.toLowerCase()}`);

    let rejectionReason: string | undefined;
    if (!approve) {
      rejectionReason = RejectSchema.parse(req.body).reason;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedBy: req.user!.id,
        decidedAt: new Date(),
        rejectionReason,
      },
      include,
    });

    logAction(req.user!.id, 'UPDATE', 'LeaveRequest', request.id, { action: approve ? 'approved' : 'rejected' });
    sseManager.broadcastAll(orgId, SSEEvent.LEAVE_UPDATED, { id: request.id, userId: request.userId, type: 'decided' });
    if (approve) computeDays(orgId, request.userId, request.startDate, request.endDate).catch(() => {});

    await prisma.notification.create({
      data: {
        orgId, userId: request.userId, type: 'STATUS_CHANGE',
        title: `Your ${request.leaveType.name} request was ${approve ? 'approved' : 'rejected'}`,
        body: rejectionReason,
        entityId: request.id, entityType: 'LEAVE_REQUEST',
      },
    });
    const requester = await prisma.user.findUnique({ where: { id: request.userId } });
    if (requester) {
      sendMail({
        ...emailTemplates.leaveDecision(requester.email, requester.name, request.leaveType.name, fmt(request.startDate), fmt(request.endDate), approve, rejectionReason),
        orgId,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (err) { next(err); }
}

export const approveRequest = (req: AuthRequest, res: Response, next: NextFunction) => decide(req, res, next, true);
export const rejectRequest  = (req: AuthRequest, res: Response, next: NextFunction) => decide(req, res, next, false);


// ─── Admin leave control ─────────────────────────────────────────────────────

const OnBehalfSchema = RequestSchema.extend({ userId: z.string(), autoApprove: z.boolean().optional() });

/** POST /hr/leave/requests/on-behalf — a manager applies for an employee; optionally approved immediately. Audited. */
export async function applyOnBehalf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = OnBehalfSchema.parse(req.body);
    const [target, leaveType] = await Promise.all([prisma.user.findFirst({ where: { id: data.userId, orgId } }), prisma.leaveType.findFirst({ where: { id: data.leaveTypeId, orgId, isActive: true } })]);
    if (!target || !leaveType) throw new AppError(404, 'Employee or leave type not found');
    const startDate = parseD(data.startDate); const endDate = data.halfDay ? startDate : parseD(data.endDate);
    if (endDate < startDate) throw new AppError(400, 'End date must be on or after the start date');
    const days = leaveDays(startDate, endDate, !!data.halfDay);
    const overlap = await prisma.leaveRequest.findFirst({ where: { orgId, userId: data.userId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
    if (overlap) throw new AppError(400, 'The employee already has leave on those dates');
    const approve = data.autoApprove !== false;
    const request = await prisma.leaveRequest.create({
      data: {
        orgId, userId: data.userId, leaveTypeId: data.leaveTypeId, startDate, endDate, days, halfDay: !!data.halfDay, halfDayPeriod: data.halfDay ? (data.halfDayPeriod ?? 'AM') : null,
        reason: data.reason, appliedBy: req.user!.id,
        ...(approve ? { status: 'APPROVED', decidedBy: req.user!.id, decidedAt: new Date() } : {}),
      }, include,
    });
    await audit(orgId, req.user!.id, { userId: data.userId, date: startDate, entityType: 'LEAVE_REQUEST', entityId: request.id, action: 'LEAVE_APPLY_ON_BEHALF', after: { leaveType: leaveType.name, startDate: fmt(startDate), endDate: fmt(endDate), days, status: request.status }, reason: data.reason ?? null });
    if (approve) computeDays(orgId, data.userId, startDate, endDate).catch(() => {});
    sseManager.broadcastAll(orgId, SSEEvent.LEAVE_UPDATED, { id: request.id, userId: data.userId, type: 'created' });
    res.status(201).json(request);
  } catch (err) { next(err); }
}

const ModifySchema = z.object({
  leaveTypeId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  halfDay: z.boolean().optional(),
  halfDayPeriod: z.enum(['AM', 'PM']).optional(),
  reason: z.string().optional(),
  changeReason: z.string().min(1),
});

/** PATCH /hr/leave/requests/:id — a manager modifies a pending or approved request (dates, type, half day). Audited. */
export async function modifyRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = ModifySchema.parse(req.body);
    const request = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, orgId }, include });
    if (!request) throw new AppError(404, 'Leave request not found');
    if (!['PENDING', 'APPROVED'].includes(request.status)) throw new AppError(400, 'Only pending or approved requests can be modified');
    const startDate = data.startDate ? parseD(data.startDate) : request.startDate;
    const halfDay = data.halfDay ?? request.halfDay;
    const endDate = halfDay ? startDate : data.endDate ? parseD(data.endDate) : request.endDate;
    if (endDate < startDate) throw new AppError(400, 'End date must be on or after the start date');
    const days = leaveDays(startDate, endDate, halfDay);
    const before = { leaveTypeId: request.leaveTypeId, startDate: fmt(request.startDate), endDate: fmt(request.endDate), days: Number(request.days), halfDay: request.halfDay };
    const updated = await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { leaveTypeId: data.leaveTypeId ?? request.leaveTypeId, startDate, endDate, days, halfDay, halfDayPeriod: halfDay ? (data.halfDayPeriod ?? request.halfDayPeriod ?? 'AM') : null, reason: data.reason ?? request.reason },
      include,
    });
    await audit(orgId, req.user!.id, { userId: request.userId, date: startDate, entityType: 'LEAVE_REQUEST', entityId: request.id, action: 'LEAVE_MODIFY', before, after: { leaveTypeId: updated.leaveTypeId, startDate: fmt(startDate), endDate: fmt(endDate), days, halfDay }, reason: data.changeReason });
    // Recompute both the old and the new range so stale LEAVE days are cleared
    const lo = new Date(Math.min(request.startDate.getTime(), startDate.getTime())), hi = new Date(Math.max(request.endDate.getTime(), endDate.getTime()));
    if (updated.status === 'APPROVED') computeDays(orgId, request.userId, lo, hi).catch(() => {});
    sseManager.broadcastAll(orgId, SSEEvent.LEAVE_UPDATED, { id: request.id, userId: request.userId, type: 'modified' });
    res.json(updated);
  } catch (err) { next(err); }
}

/** POST /hr/leave/requests/:id/admin-cancel — a manager cancels a pending OR approved request (balance is restored; attendance recomputed). Audited. */
export async function adminCancel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const request = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, orgId }, include });
    if (!request) throw new AppError(404, 'Leave request not found');
    if (!['PENDING', 'APPROVED'].includes(request.status)) throw new AppError(400, `This request is already ${request.status.toLowerCase()}`);
    const updated = await prisma.leaveRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED', cancelledBy: req.user!.id, cancelledAt: new Date(), cancelReason: reason }, include });
    await audit(orgId, req.user!.id, { userId: request.userId, date: request.startDate, entityType: 'LEAVE_REQUEST', entityId: request.id, action: 'LEAVE_CANCEL', before: { status: request.status }, after: { status: 'CANCELLED' }, reason });
    computeDays(orgId, request.userId, request.startDate, request.endDate).catch(() => {});
    await prisma.notification.create({ data: { orgId, userId: request.userId, type: 'STATUS_CHANGE', title: `Your ${request.leaveType.name} (${fmt(request.startDate)}) was cancelled by ${req.user!.email}`, body: reason, entityId: request.id, entityType: 'LEAVE_REQUEST' } });
    sseManager.broadcastAll(orgId, SSEEvent.LEAVE_UPDATED, { id: request.id, userId: request.userId, type: 'cancelled' });
    res.json(updated);
  } catch (err) { next(err); }
}

const ConvertSchema = z.object({ userId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), leaveTypeId: z.string(), halfDay: z.boolean().optional(), halfDayPeriod: z.enum(['AM', 'PM']).optional(), reason: z.string().min(1) });

/** POST /hr/leave/convert — turn an absent/LOP/half day into approved leave (e.g. employee forgot to apply). Audited. */
export async function convertAttendanceToLeave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = ConvertSchema.parse(req.body);
    const [target, leaveType] = await Promise.all([prisma.user.findFirst({ where: { id: data.userId, orgId } }), prisma.leaveType.findFirst({ where: { id: data.leaveTypeId, orgId, isActive: true } })]);
    if (!target || !leaveType) throw new AppError(404, 'Employee or leave type not found');
    const date = parseD(data.date);
    const existing = await prisma.leaveRequest.findFirst({ where: { orgId, userId: data.userId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: date }, endDate: { gte: date } } });
    if (existing) throw new AppError(400, 'There is already leave on that date');
    const dayBefore = await prisma.attendanceDay.findUnique({ where: { userId_date: { userId: data.userId, date } } });
    const request = await prisma.leaveRequest.create({
      data: { orgId, userId: data.userId, leaveTypeId: data.leaveTypeId, startDate: date, endDate: date, days: data.halfDay ? 0.5 : 1, halfDay: !!data.halfDay, halfDayPeriod: data.halfDay ? (data.halfDayPeriod ?? 'AM') : null, reason: data.reason, appliedBy: req.user!.id, status: 'APPROVED', decidedBy: req.user!.id, decidedAt: new Date() },
      include,
    });
    // Drop any manual override so the engine reflects the leave
    await prisma.attendanceDay.deleteMany({ where: { userId: data.userId, date, source: 'MANUAL' } });
    const { days } = await computeDays(orgId, data.userId, date, date);
    await audit(orgId, req.user!.id, { userId: data.userId, date, entityType: 'ATTENDANCE_DAY', entityId: days[0]?.id, action: 'CONVERT_TO_LEAVE', before: dayBefore ? { status: dayBefore.status } : null, after: { status: days[0]?.status, leaveType: leaveType.name, requestId: request.id }, reason: data.reason });
    sseManager.broadcastAll(orgId, SSEEvent.ATTENDANCE_UPDATED, { userId: data.userId, type: 'corrected' });
    res.status(201).json({ request, day: days[0] });
  } catch (err) { next(err); }
}
