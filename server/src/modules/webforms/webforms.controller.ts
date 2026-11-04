/**
 * Web forms — public web-to-lead / web-to-ticket.
 *
 * Admin side (MANAGERS):
 *   GET/POST /api/web-forms, PATCH/DELETE /api/web-forms/:id
 *
 * Public side (NO auth — embedded on the org's own website):
 *   GET  /api/public/forms/:id          form metadata for the hosted page
 *   POST /api/public/forms/:id/submit   one submission
 *
 * A submission creates a real Contact + Lead or Contact + Ticket through the
 * same shapes the app's own controllers use, and fires the same
 * LEAD_CREATED / TICKET_CREATED workflows — so department routing, AI
 * auto-assign, notifications and Slack posts all behave exactly as if the
 * record was filed in-app.
 *
 * Abuse guards for the unauthenticated endpoint: per-IP + per-form rate
 * limiting (in-memory, best-effort), a honeypot field bots fill and humans
 * never see, hard length caps, and rich text stripped to plain text.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { logAction } from '../../utils/auditLog';
import { runWorkflows } from '../../utils/workflow-engine';
import { sseManager, SSEEvent } from '../../utils/sse';
import { notifyOrgAdmins } from '../notifications/notifications.controller';

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

// Secret for server-to-server intake (Zoho webhooks, Google Apps Script,
// Zapier…). Sent as the x-intake-token header; proves the caller is the
// org's own integration, so the per-IP rate limit doesn't apply (webhook
// traffic all arrives from one provider IP and would trip it instantly).
const newIntakeToken = () => `wfk_${crypto.randomBytes(24).toString('hex')}`;

function tokenMatches(given: string, actual: string | null): boolean {
  if (!actual || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const FormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['LEAD', 'TICKET']),
  title: z.string().trim().max(120).optional(),
  intro: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

export async function listForms(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    let forms = await prisma.webForm.findMany({
      where: { orgId: req.user!.orgId }, orderBy: { createdAt: 'desc' },
    });
    // Lazy backfill: forms created before intake tokens existed get one the
    // first time an admin looks at the list.
    const missing = forms.filter(f => !f.intakeToken);
    if (missing.length) {
      await Promise.all(missing.map(f =>
        prisma.webForm.update({ where: { id: f.id }, data: { intakeToken: newIntakeToken() } })));
      forms = await prisma.webForm.findMany({
        where: { orgId: req.user!.orgId }, orderBy: { createdAt: 'desc' },
      });
    }
    res.json(forms);
  } catch (err) { next(err); }
}

export async function createForm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = FormSchema.parse(req.body);
    const count = await prisma.webForm.count({ where: { orgId: req.user!.orgId } });
    if (count >= 20) throw new AppError(400, 'Form limit reached (20 per organization)');
    const form = await prisma.webForm.create({
      data: { ...data, orgId: req.user!.orgId, createdBy: req.user!.id, intakeToken: newIntakeToken() },
    });
    logAction(req.user!.id, 'CREATE', 'WebForm', form.id, { name: form.name, type: form.type });
    res.status(201).json(form);
  } catch (err) { next(err); }
}

export async function updateForm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = FormSchema.partial().parse(req.body);
    const updated = await prisma.webForm.updateMany({
      where: { id: req.params.id, orgId: req.user!.orgId }, data,
    });
    if (!updated.count) throw new AppError(404, 'Form not found');
    res.json(await prisma.webForm.findUnique({ where: { id: req.params.id } }));
  } catch (err) { next(err); }
}

/** Rotate the intake token — invalidates every integration using the old one. */
export async function rotateToken(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const owned = await prisma.webForm.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!owned) throw new AppError(404, 'Form not found');
    const form = await prisma.webForm.update({
      where: { id: owned.id }, data: { intakeToken: newIntakeToken() },
    });
    logAction(req.user!.id, 'UPDATE', 'WebForm', form.id, { rotatedIntakeToken: true });
    res.json(form);
  } catch (err) { next(err); }
}

export async function deleteForm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const del = await prisma.webForm.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!del.count) throw new AppError(404, 'Form not found');
    logAction(req.user!.id, 'DELETE', 'WebForm', req.params.id);
    res.json({ message: 'Form deleted' });
  } catch (err) { next(err); }
}

// ─── Public: rate limiting ───────────────────────────────────────────────────
// Best-effort in-memory limiter — enough to blunt naive abuse without
// infrastructure. 10 submissions / 10 minutes per IP, 60 / hour per form.

const ipHits = new Map<string, number[]>();
const formHits = new Map<string, number[]>();
function limited(map: Map<string, number[]>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (map.get(key) ?? []).filter(t => now - t < windowMs);
  if (arr.length >= max) { map.set(key, arr); return true; }
  arr.push(now); map.set(key, arr);
  if (map.size > 5000) for (const [k, v] of map) { if (!v.some(t => now - t < windowMs)) map.delete(k); }
  return false;
}

// ─── Public: metadata for the hosted page ────────────────────────────────────

export async function publicFormMeta(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await prisma.webForm.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, type: true, title: true, intro: true, isActive: true, orgId: true, org: { select: { name: true } } },
    });
    if (!form || !form.isActive) throw new AppError(404, 'This form is not available');
    res.json({
      id: form.id, type: form.type,
      title: form.title || (form.type === 'LEAD' ? 'Contact our sales team' : 'Submit a support request'),
      intro: form.intro || null,
      orgName: form.org.name,
      orgId: form.orgId, // for the public branding lookup (logo/color)
    });
  } catch (err) { next(err); }
}

// ─── Public: submission ──────────────────────────────────────────────────────

const strip = (v: unknown, max: number) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);

export async function publicFormSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await prisma.webForm.findUnique({ where: { id: req.params.id } });
    if (!form || !form.isActive) throw new AppError(404, 'This form is not available');

    // A valid x-intake-token marks a trusted server-to-server integration
    // (Zoho webhook, Google Apps Script, Zapier). Those all send from one
    // provider IP, so the per-IP limit is skipped for them — they get a
    // higher per-form budget instead. Anonymous browser traffic keeps both
    // original limits.
    const trusted = tokenMatches(String(req.headers['x-intake-token'] ?? ''), form.intakeToken);
    if (trusted) {
      if (limited(formHits, `${form.id}:intake`, 600, 60 * 60_000)) throw new AppError(429, 'This form is receiving too many submissions — try again later');
    } else {
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
      if (limited(ipHits, ip, 10, 10 * 60_000)) throw new AppError(429, 'Too many submissions — try again later');
      if (limited(formHits, form.id, 60, 60 * 60_000)) throw new AppError(429, 'This form is receiving too many submissions — try again later');
    }
    const orgId = form.orgId;

    // Honeypot: a hidden "website" field humans never fill. Bots do. Answer
    // 200 so the bot believes it worked, and write nothing.
    if (String(req.body?.website ?? '').trim()) return res.json({ ok: true });

    const name = strip(req.body?.name, 120);
    const email = strip(req.body?.email, 200).toLowerCase();
    const phone = strip(req.body?.phone, 40);
    const company = strip(req.body?.company, 120);
    const subject = strip(req.body?.subject, 200);
    const message = strip(req.body?.message, 4000);
    if (!name) throw new AppError(400, 'Name is required');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'A valid email is required');

    // Contact reuse-by-email, same as CREATE_LEAD's action handler — repeat
    // submitters don't multiply into duplicate contacts.
    let contact = await prisma.contact.findFirst({ where: { orgId, email: { equals: email, mode: 'insensitive' } } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: { orgId, name, email, phone: phone || undefined, ownerId: form.createdBy, source: 'Web Form' },
      });
    }

    if (form.type === 'LEAD') {
      const lead = await prisma.lead.create({
        data: {
          orgId, contactId: contact.id, source: 'Web Form',
          notes: [company && `Company: ${company}`, message].filter(Boolean).join('\n') || undefined,
          // Deliberately UNASSIGNED so an AI Auto-Assign / Assign-To rule
          // owns the routing decision; without one it sits in the queue.
        },
        include: { contact: { select: { name: true } }, department: { select: { name: true } } },
      });
      runWorkflows({
        trigger: 'LEAD_CREATED', orgId, entityType: 'LEAD', entityId: lead.id,
        entity: { ...(lead as any), departmentName: null },
      }).catch(() => {});
      notifyOrgAdmins({ orgId, type: 'LEAD_CREATED', title: `Web form lead: ${name}`, body: form.name, entityType: 'LEAD', entityId: lead.id }).catch(() => {});
    } else {
      const ticket = await prisma.ticket.create({
        data: {
          orgId,
          title: subject || `Web request from ${name}`,
          body: message || subject || 'Submitted via web form',
          priority: 'MEDIUM',
          // The public visitor has no login — the linked Contact identifies
          // them (same pattern as filing on behalf of a contact); the form's
          // creator satisfies the required requester FK.
          requesterId: form.createdBy,
          contactId: contact.id,
        },
        include: { requester: { select: { id: true, name: true, email: true } }, contact: { select: { id: true, name: true, email: true } }, department: { select: { name: true } } },
      });
      await prisma.ticketHistory.create({ data: { ticketId: ticket.id, toStatus: 'OPEN', changedBy: form.createdBy } });
      runWorkflows({
        trigger: 'TICKET_CREATED', orgId, entityType: 'TICKET', entityId: ticket.id,
        entity: { ...(ticket as any), departmentName: null },
      }).catch(() => {});
      sseManager.broadcastAll(orgId, SSEEvent.TICKET_CREATED, { id: ticket.id, title: ticket.title, priority: ticket.priority, status: ticket.status });
      notifyOrgAdmins({ orgId, type: 'TICKET_CREATED', title: `Web form ticket: ${ticket.title}`, body: `From ${name} (${email})`, entityType: 'TICKET', entityId: ticket.id }).catch(() => {});
    }

    await prisma.webForm.update({
      where: { id: form.id },
      data: { submissionCount: { increment: 1 }, lastSubmissionAt: new Date() },
    });
    res.json({ ok: true, message: form.type === 'LEAD' ? 'Thanks — our team will reach out shortly.' : 'Thanks — your request has been received.' });
  } catch (err) { next(err); }
}
