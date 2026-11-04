import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { logAction } from '../../utils/auditLog';

/**
 * GDPR / data-portability & right-to-erasure helpers. Two scopes:
 *  - "me" endpoints: any authenticated user can export or request deletion
 *    of their own personal data — no manager approval needed, since it's
 *    their own account.
 *  - "org" export: a full-tenant data dump, restricted to SUPER_ADMIN, for
 *    responding to a customer's/regulator's data-access request or for an
 *    org offboarding the platform.
 *
 * "Deletion" here means anonymization + deactivation, not a hard DELETE —
 * this app's schema doesn't cascade-delete a User out of Tickets/Deals/
 * Comments/etc. (most of those relations have no onDelete: Cascade — see
 * schema.prisma), so a hard delete would either orphan foreign keys or
 * require rewriting the ownership of every record that user ever touched.
 * Anonymizing keeps referential integrity (the ticket/deal/comment history
 * stays intact) while scrubbing the PII a GDPR erasure request is actually
 * about — name, email, phone, avatar.
 */

// ─── Self-service ────────────────────────────────────────────────────────────

/** GET /api/gdpr/export/me — every record referencing the caller, as downloadable JSON */
export async function exportMyData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.orgId;

    const [profile, activities, comments, ticketsRequested, ticketsAssigned, dealsAssigned, contactsOwned, timeEntries, auditLogs] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, department: true, phone: true, avatarUrl: true, createdAt: true },
      }),
      prisma.activity.findMany({ where: { orgId, createdBy: userId } }),
      prisma.comment.findMany({ where: { authorId: userId } }),
      prisma.ticket.findMany({ where: { orgId, requesterId: userId }, select: { id: true, title: true, status: true, priority: true, createdAt: true } }),
      prisma.ticket.findMany({ where: { orgId, assignedTo: userId }, select: { id: true, title: true, status: true, priority: true, createdAt: true } }),
      prisma.deal.findMany({ where: { orgId, assignedTo: userId }, select: { id: true, title: true, value: true, stage: true, status: true, createdAt: true } }),
      prisma.contact.findMany({ where: { orgId, ownerId: userId }, select: { id: true, name: true, email: true, createdAt: true } }),
      prisma.timeEntry.findMany({ where: { orgId, userId } }),
      prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
    ]);

    logAction(userId, 'READ', 'User', userId, { action: 'gdpr_export_self' });

    res.setHeader('Content-Disposition', `attachment; filename="my-data-export-${userId}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      profile, activities, comments, ticketsRequested, ticketsAssigned, dealsAssigned, contactsOwned, timeEntries, auditLogs,
    });
  } catch (err) { next(err); }
}

const DeleteMeSchema = z.object({ password: z.string().min(1), confirm: z.literal(true) });

/**
 * POST /api/gdpr/delete-request/me — self-service anonymization. Requires
 * the caller's current password as a confirmation step (this is a
 * destructive, irreversible action on their own account), and blocks the
 * organization's last active SUPER_ADMIN from anonymizing themselves so an
 * org can never be left with zero admins.
 */
export async function deleteMyData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { password } = DeleteMeSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError(404, 'User not found');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(400, 'Incorrect password');

    if (user.role === 'SUPER_ADMIN') {
      const otherAdmins = await prisma.user.count({
        where: { orgId: user.orgId, role: 'SUPER_ADMIN', isActive: true, NOT: { id: user.id } },
      });
      if (otherAdmins === 0) {
        throw new AppError(400, 'You are the only active admin in this organization — promote another user to Super Admin before deleting your account.');
      }
    }

    const anonymizedEmail = `deleted-${user.id}@deleted.local`;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          name: 'Deleted User', email: anonymizedEmail, phone: null, avatarUrl: null,
          isActive: false, googleId: null,
        },
      }),
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      prisma.pushSubscription.deleteMany({ where: { userId: user.id } }),
      prisma.calendarConnection.deleteMany({ where: { userId: user.id } }),
    ]);

    logAction(user.id, 'DELETE', 'User', user.id, { action: 'gdpr_self_anonymize' });
    res.json({ message: 'Your account has been deactivated and personal data removed. Your historical records (tickets, deals, comments) are kept for the organization\'s continuity but no longer show your name.' });
  } catch (err) { next(err); }
}

// ─── Admin (org-wide) ────────────────────────────────────────────────────────

/** GET /api/gdpr/export/org — SUPER_ADMIN only; full tenant data export */
export async function exportOrgData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const [org, users, contacts, accounts, leads, deals, tickets, quotes, campaigns, changeRequests] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId } }),
      prisma.user.findMany({ where: { orgId }, select: { id: true, name: true, email: true, role: true, department: true, phone: true, isActive: true, createdAt: true } }),
      prisma.contact.findMany({ where: { orgId } }),
      prisma.account.findMany({ where: { orgId } }),
      prisma.lead.findMany({ where: { orgId } }),
      prisma.deal.findMany({ where: { orgId } }),
      prisma.ticket.findMany({ where: { orgId } }),
      prisma.quote.findMany({ where: { orgId }, include: { lines: true } }),
      prisma.campaign.findMany({ where: { orgId } }),
      prisma.changeRequest.findMany({ where: { orgId } }),
    ]);

    logAction(req.user!.id, 'READ', 'Organization', orgId, { action: 'gdpr_export_org' });

    res.setHeader('Content-Disposition', `attachment; filename="org-data-export-${orgId}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      org, users, contacts, accounts, leads, deals, tickets, quotes, campaigns, changeRequests,
    });
  } catch (err) { next(err); }
}

/** POST /api/gdpr/anonymize/:userId — SUPER_ADMIN; anonymizes a coworker's account (offboarding / erasure request on someone else's behalf) */
export async function anonymizeUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.userId, orgId: req.user!.orgId } });
    if (!target) throw new AppError(404, 'User not found');
    if (target.id === req.user!.id) throw new AppError(400, 'Use the self-service "Delete my data" option in your own Profile for your own account');

    const anonymizedEmail = `deleted-${target.id}@deleted.local`;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: target.id },
        data: { name: 'Deleted User', email: anonymizedEmail, phone: null, avatarUrl: null, isActive: false, googleId: null },
      }),
      prisma.refreshToken.deleteMany({ where: { userId: target.id } }),
      prisma.pushSubscription.deleteMany({ where: { userId: target.id } }),
      prisma.calendarConnection.deleteMany({ where: { userId: target.id } }),
    ]);

    logAction(req.user!.id, 'DELETE', 'User', target.id, { action: 'gdpr_admin_anonymize' });
    res.json({ message: `${target.name}'s personal data has been removed.` });
  } catch (err) { next(err); }
}
