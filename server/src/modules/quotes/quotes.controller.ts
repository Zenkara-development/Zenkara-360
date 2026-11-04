import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { runWorkflows } from '../../utils/workflow-engine';
import { nextInvoiceNumber } from '../invoices/invoices.controller';
import { purgeEntityChildren } from '../../utils/entityCleanup';

const LineSchema = z.object({
  description: z.string().min(1),
  quantity:    z.coerce.number().positive().default(1),
  unitPrice:   z.coerce.number().min(0),
  discount:    z.coerce.number().min(0).max(100).default(0),
});

const QuoteSchema = z.object({
  title:      z.string().min(1),
  dealId:     z.string().optional().nullable(),
  notes:      z.string().optional().nullable(),
  validUntil: z.string().optional().nullable(),
  lines:      z.array(LineSchema).min(1),
});

const include = {
  lines: true,
  deal:  { select: { id: true, title: true } },
  creator: { select: { id: true, name: true } },
};

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { dealId, status } = req.query as Record<string, string>;
    const where: any = { orgId: req.user!.orgId };
    if (dealId) where.dealId = dealId;
    if (status) where.status = status;
    const quotes = await prisma.quote.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    res.json({ data: quotes });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { lines, ...data } = QuoteSchema.parse(req.body);
    const quote = await prisma.quote.create({
      data: {
        ...data,
        orgId,
        createdBy: req.user!.id,
        dealId: data.dealId ?? undefined,
        notes: data.notes ?? undefined,
        validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
        lines: { create: lines },
      },
      include,
    });
    res.status(201).json(quote);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const quote = await prisma.quote.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include,
    });
    if (!quote) throw new AppError(404, 'Quote not found');
    res.json(quote);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { lines, ...data } = QuoteSchema.partial().parse(req.body);
    const quote = await prisma.quote.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!quote) throw new AppError(404, 'Quote not found');

    // Replace lines if provided
    if (lines) {
      await prisma.quoteLine.deleteMany({ where: { quoteId: req.params.id } });
    }
    const updated = await prisma.quote.update({
      where: { id: req.params.id },
      data: {
        ...data,
        dealId: data.dealId ?? undefined,
        validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
        ...(lines ? { lines: { create: lines } } : {}),
      },
      include,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function changeStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = z.object({
      status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']),
    }).parse(req.body);
    const quote = await prisma.quote.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!quote) throw new AppError(404, 'Quote not found');
    const updated = await prisma.quote.update({ where: { id: req.params.id }, data: { status }, include });
    runWorkflows({ trigger: 'QUOTE_STATUS_CHANGED', orgId: req.user!.orgId, entityType: 'QUOTE', entityId: updated.id, entity: updated as any, previousEntity: quote as any }).catch(() => {});
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.quote.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('QUOTE', req.params.id, req.user!.orgId);
    res.json({ message: 'Quote deleted' });
  } catch (err) { next(err); }
}

// ─── Public quote sharing & e-signature ─────────────────────────────────────
// No new "share token" column — the token is a deterministic HMAC of the
// quote id, so a shareable link can be generated (and re-generated) without
// a write, the same way a JWT proves possession without a DB round-trip.
// Anyone with the link can view/sign the quote, same trust model as the CSAT
// survey link and the customer portal's magic-link (knowledge of the link IS
// the authorization) — acceptable here since the link is only ever handed to
// the customer being quoted, not published anywhere.

function quoteShareToken(quoteId: string): string {
  // No hardcoded fallback — a guessable key would let anyone forge share links.
  const secret = process.env.QUOTE_SHARE_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new AppError(500, 'Server misconfigured: set QUOTE_SHARE_SECRET (or JWT_SECRET)');
  return crypto.createHmac('sha256', secret).update(quoteId).digest('hex').slice(0, 32);
}

/** GET /quotes/:id/share-link — staff-only; returns the public URL to send to the customer */
export async function getShareLink(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const quote = await prisma.quote.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!quote) throw new AppError(404, 'Quote not found');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/quote/${quote.id}?t=${quoteShareToken(quote.id)}`;
    res.json({ link });
  } catch (err) { next(err); }
}

/** GET /quotes/public/:id?t=... — public, token-secured read-only view for the customer */
export async function publicView(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const token = String(req.query.t || '');
    if (!token || token !== quoteShareToken(id)) throw new AppError(404, 'Quote not found');
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        lines: true,
        org: { select: { name: true, currency: true, timezone: true } },
        deal: { select: { id: true, title: true } },
      },
    });
    if (!quote) throw new AppError(404, 'Quote not found');
    res.json(quote);
  } catch (err) { next(err); }
}

const AcceptSchema = z.object({
  token: z.string(),
  signerName: z.string().min(2),
  signerEmail: z.string().email(),
  agreed: z.literal(true),
  // Hand-drawn signature captured on a <canvas> pad, sent as a base64 PNG
  // data URL ("data:image/png;base64,..."). Optional so a customer on a
  // device where the pad genuinely doesn't work (e.g. no pointer events)
  // isn't blocked from accepting — the typed name + IP/timestamp trail
  // still applies either way.
  signatureImage: z.string().startsWith('data:image/').optional(),
});

/**
 * POST /quotes/public/:id/accept — public, token-secured. Captures a simple
 * in-app e-signature (typed name + explicit agreement + timestamp/IP audit
 * trail) rather than a legally-certified signature product — see the Quote
 * model comment in schema.prisma. Moves the quote straight to ACCEPTED.
 */
export async function publicAccept(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const body = AcceptSchema.parse(req.body);
    if (body.token !== quoteShareToken(id)) throw new AppError(404, 'Quote not found');

    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) throw new AppError(404, 'Quote not found');
    if (quote.status === 'ACCEPTED') throw new AppError(400, 'This quote has already been accepted');
    if (quote.status === 'REJECTED') throw new AppError(400, 'This quote was rejected and can no longer be accepted');

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const updated = await prisma.quote.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        signerName: body.signerName,
        signerEmail: body.signerEmail,
        signedAt: new Date(),
        signerIp: ip,
        signatureImage: body.signatureImage,
      },
      include: { lines: true },
    });

    // Automation hook — the customer just accepted via the public link, which
    // is exactly the moment "notify the rep / webhook the ERP" rules want.
    runWorkflows({ trigger: 'QUOTE_STATUS_CHANGED', orgId: updated.orgId, entityType: 'QUOTE', entityId: updated.id, entity: updated as any, previousEntity: quote as any }).catch(() => {});

    // Auto-generate an invoice from the accepted quote's line items — fire-
    // and-forget in the sense that a failure here shouldn't block the
    // customer's acceptance from succeeding (they already signed); staff can
    // always create one by hand from the Invoices page if this somehow fails.
    try {
      const invoiceNumber = await nextInvoiceNumber(updated.orgId);
      await prisma.invoice.create({
        data: {
          orgId: updated.orgId,
          quoteId: updated.id,
          dealId: updated.dealId,
          invoiceNumber,
          title: updated.title,
          status: 'SENT',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
          createdBy: updated.createdBy,
          lines: {
            create: updated.lines.map(l => ({
              description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount,
            })),
          },
        },
      });
    } catch (invoiceErr) {
      console.error('[quotes] Failed to auto-generate invoice for accepted quote', id, invoiceErr);
    }

    res.json(updated);
  } catch (err) { next(err); }
}
