import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { emailField } from '../../utils/zodHelpers';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../utils/prisma';
import { sendMail } from '../../utils/mailer';
import { PortalRequest } from '../../middleware/authenticatePortal';
import { AppError } from '../../middleware/errorHandler';
import { sseManager, SSEEvent } from '../../utils/sse';
import { notifyOrgAdmins } from '../notifications/notifications.controller';

function hashToken(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// POST /api/portal/request-access
// Public — customer enters email to get magic link
export async function requestAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, orgId } = z.object({ email: emailField(), orgId: z.string() }).parse(req.body);

    // Distinct from the "email not registered" case below, which stays
    // silent on purpose (anti-enumeration) — a missing orgId isn't a
    // privacy-sensitive lookup miss, it means the customer reached /portal
    // without the ?org=... query param their invite link always includes
    // (e.g. a bookmarked/typed bare /portal URL), so nothing was ever going
    // to match and no email attempt should be made to look like it worked.
    if (!orgId) {
      throw new AppError(400, "This portal link is missing your organization — please use the exact link from your invite email, or ask your support team to resend it.");
    }

    const portalUser = await prisma.portalUser.findUnique({ where: { orgId_email: { orgId, email } } });
    if (!portalUser || !portalUser.isActive) {
      // Return success regardless to prevent email enumeration
      return res.json({ message: 'If that email is registered, a login link has been sent.' });
    }

    // Invalidate any existing unused tokens
    await prisma.portalToken.deleteMany({ where: { portalUserId: portalUser.id, usedAt: null } });

    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await prisma.portalToken.create({ data: { portalUserId: portalUser.id, tokenHash, expiresAt } });

    const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/verify?token=${raw}&org=${orgId}`;

    await sendMail({
      orgId,
      to: email,
      subject: 'Your portal login link',
      html: `
        <p>Hello ${portalUser.name},</p>
        <p>Click the link below to access your support portal. This link expires in 30 minutes.</p>
        <p><a href="${portalUrl}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Access Portal</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });

    res.json({ message: 'If that email is registered, a login link has been sent.' });
  } catch (err) { next(err); }
}

// GET /api/portal/verify?token=xxx&org=xxx
// Public — validates magic link token, returns portal JWT
export async function verifyToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, org: orgId } = z.object({ token: z.string(), org: z.string() }).parse(req.query);

    const tokenHash = hashToken(token);
    const portalToken = await prisma.portalToken.findUnique({
      where: { tokenHash },
      include: { portalUser: true },
    });

    if (!portalToken || portalToken.usedAt || new Date() > portalToken.expiresAt) {
      throw new AppError(401, 'Invalid or expired login link. Please request a new one.');
    }
    if (portalToken.portalUser.orgId !== orgId || !portalToken.portalUser.isActive) {
      throw new AppError(401, 'Unauthorised');
    }

    // Mark token as used
    await prisma.portalToken.update({ where: { id: portalToken.id }, data: { usedAt: new Date() } });

    // Update lastLoginAt
    await prisma.portalUser.update({ where: { id: portalToken.portalUserId }, data: { lastLoginAt: new Date() } });

    const sessionJwt = jwt.sign(
      { sub: portalToken.portalUserId, orgId, iss: 'portal' },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // Portal is its own bespoke, non-authenticated-app session — it can't
    // call GET /org the way logged-in staff pages do, so the org's timezone
    // (needed to show ticket dates in the org's zone rather than whatever
    // zone the customer's own browser happens to be in) rides along in the
    // login response instead, same pattern as the public quote/invoice pages.
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });

    res.json({
      token: sessionJwt,
      user: {
        id: portalToken.portalUser.id,
        name: portalToken.portalUser.name,
        email: portalToken.portalUser.email,
        orgId,
        orgTimezone: org?.timezone || 'UTC',
      }
    });
  } catch (err) { next(err); }
}

// GET /api/portal/me
export async function getMe(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.portalUser.findUnique({ where: { id: req.portal!.portalUserId } });
    if (!user) throw new AppError(404, 'Portal user not found');
    res.json({ id: user.id, name: user.name, email: user.email, orgId: user.orgId });
  } catch (err) { next(err); }
}

// GET /api/portal/tickets
export async function listTickets(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    const tickets = await (prisma.ticket as any).findMany({
      where: { orgId: req.portal!.orgId, portalUserId: req.portal!.portalUserId },
      select: { id: true, title: true, body: true, status: true, priority: true, createdAt: true, updatedAt: true, category: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tickets);
  } catch (err) { next(err); }
}

// POST /api/portal/tickets
export async function createTicket(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    const { title, body, categoryId } = z.object({ title: z.string().min(1), body: z.string().min(1), categoryId: z.string().optional() }).parse(req.body);
    const orgId = req.portal!.orgId;
    const portalUserId = req.portal!.portalUserId;

    // Use any org admin as the technical requesterId (required by schema)
    const adminUser = await prisma.user.findFirst({ where: { orgId, role: { in: ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'] }, isActive: true } });
    if (!adminUser) throw new AppError(500, 'Org has no IT staff — cannot create ticket');

    const ticket = await (prisma.ticket as any).create({
      data: { title, body, categoryId, orgId, requesterId: adminUser.id, portalUserId },
      select: { id: true, title: true, body: true, status: true, priority: true, createdAt: true },
    });
    res.status(201).json(ticket);
  } catch (err) { next(err); }
}

// GET /api/portal/tickets/:id
export async function getTicket(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    const ticket = await (prisma.ticket as any).findFirst({
      where: { id: req.params.id, orgId: req.portal!.orgId, portalUserId: req.portal!.portalUserId },
      select: { id: true, title: true, body: true, status: true, priority: true, createdAt: true, updatedAt: true, category: { select: { name: true } } },
    });
    if (!ticket) throw new AppError(404, 'Ticket not found');
    res.json(ticket);
  } catch (err) { next(err); }
}

// ─── Live Chat ───────────────────────────────────────────────────────────────
// Reuses the same Conversation/Message tables as the staff Unified Inbox
// (channel = 'CHAT'), so a chat started here shows up alongside Email/
// WhatsApp conversations for staff with zero new UI on that side. The portal
// frontend polls rather than holding an SSE connection open, matching this
// module's deliberately simple, non-React-Query architecture (see
// portal.controller.ts's module comment / Technical Docs section 11.3).

async function findOrCreateChatConversation(orgId: string, portalUserId: string) {
  let conversation = await prisma.conversation.findFirst({ where: { orgId, channel: 'CHAT', portalUserId } });
  if (!conversation) {
    const portalUser = await prisma.portalUser.findUnique({ where: { id: portalUserId } });
    conversation = await prisma.conversation.create({
      data: {
        orgId,
        channel: 'CHAT',
        portalUserId,
        contactName: portalUser?.name || 'Portal customer',
        contactEmail: portalUser?.email,
        subject: 'Live chat',
        lastMessageAt: new Date(),
      },
    });
  }
  return conversation;
}

// GET /api/portal/chat
export async function getChatMessages(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    const conversation = await findOrCreateChatConversation(req.portal!.orgId, req.portal!.portalUserId);
    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { sentAt: 'asc' },
    });
    // Mark staff replies as read now that the customer has fetched them
    await prisma.message.updateMany({
      where: { conversationId: conversation.id, direction: 'OUTBOUND', readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ conversationId: conversation.id, messages });
  } catch (err) { next(err); }
}

const ChatMessageSchema = z.object({ body: z.string().min(1).max(4000) });

// POST /api/portal/chat
export async function sendChatMessage(req: PortalRequest, res: Response, next: NextFunction) {
  try {
    const { body } = ChatMessageSchema.parse(req.body);
    const orgId = req.portal!.orgId;
    const conversation = await findOrCreateChatConversation(orgId, req.portal!.portalUserId);

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        fromAddress: conversation.contactEmail || 'portal-customer',
        toAddress: 'staff',
        body,
        sentAt: new Date(),
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), unreadCount: { increment: 1 }, status: 'OPEN', updatedAt: new Date() },
    });

    sseManager.broadcastAll(orgId, SSEEvent.INBOX_MESSAGE, { conversationId: conversation.id, direction: 'INBOUND', channel: 'CHAT' });
    notifyOrgAdmins({
      orgId, type: 'CHAT_MESSAGE', title: `New live chat message from ${conversation.contactName}`,
      body: body.slice(0, 140), entityType: 'CONVERSATION', entityId: conversation.id,
    }).catch(() => {});

    res.status(201).json(message);
  } catch (err) { next(err); }
}
