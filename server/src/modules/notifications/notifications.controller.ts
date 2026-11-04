import { Response, NextFunction } from 'express';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { sendPushToUser } from '../../utils/webPush';

// ─── List notifications for the current user ──────────────────────────────────

export async function listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const limit = Math.min(50, parseInt(req.query.limit as string) || 30);

    const notifications = await prisma.notification.findMany({
      // Org-scoped as well as user-scoped. Notification.userId is an
      // unconstrained FK, so a row written with a foreign userId (see the
      // CREATE_NOTIFICATION guard in utils/workflow-engine.ts) would otherwise
      // surface in that user's bell regardless of which org created it.
      where: { userId, orgId: req.user!.orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({ data: notifications, total: notifications.length });
  } catch (err) { next(err); }
}

// ─── Mark one notification as read ───────────────────────────────────────────

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const notif = await prisma.notification.findFirst({ where: { id, userId } });
    if (!notif) throw new AppError(404, 'Notification not found');

    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    res.json(updated);
  } catch (err) { next(err); }
}

// ─── Mark all as read ─────────────────────────────────────────────────────────

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (err) { next(err); }
}

// ─── Helper: create a notification (called internally by other controllers) ───

export async function createNotification(params: {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  const notification = await prisma.notification.create({ data: params });
  // Real browser push, on top of the in-app bell — see utils/webPush.ts.
  // Fire-and-forget: a push failure shouldn't fail whatever action
  // triggered this notification.
  sendPushToUser(params.userId, { title: params.title, body: params.body }).catch(() => {});
  return notification;
}

// ─── Helper: notify all admins/managers in an org ────────────────────────────

export async function notifyOrgAdmins(params: {
  orgId: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  const { orgId, ...rest } = params;
  const admins = await prisma.user.findMany({
    where: { orgId, role: { in: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] }, isActive: true },
    select: { id: true },
  });

  if (!admins.length) return;

  await prisma.notification.createMany({
    data: admins.map(a => ({ orgId, userId: a.id, ...rest })),
    skipDuplicates: true,
  });
  await Promise.all(admins.map(a => sendPushToUser(a.id, { title: rest.title, body: rest.body }).catch(() => {})));
}
