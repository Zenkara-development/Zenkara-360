import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { logAction } from '../../utils/auditLog';
import { purgeEntityChildren } from '../../utils/entityCleanup';
import { runWorkflows } from '../../utils/workflow-engine';

const include = {
  lines: true,
  deal: { select: { id: true, title: true } },
  quote: { select: { id: true, title: true } },
  creator: { select: { id: true, name: true } },
};

/** Sequential per-org display number ("INV-0001"). Not perfectly race-safe
 *  under heavy concurrent creates (count-then-format, no DB sequence) — an
 *  acceptable tradeoff at this app's scale, same as other simple counters
 *  elsewhere in the codebase; a collision would just retry via the unique
 *  constraint on (orgId, invoiceNumber) surfacing a 500 rather than silently
 *  duplicating a number. */
export async function nextInvoiceNumber(orgId: string): Promise<string> {
  const count = await prisma.invoice.count({ where: { orgId } });
  return `INV-${String(count + 1).padStart(4, '0')}`;
}

const LineSchema = z.object({
  description: z.string().min(1),
  quantity:    z.coerce.number().positive().default(1),
  unitPrice:   z.coerce.number().min(0),
  discount:    z.coerce.number().min(0).max(100).default(0),
});

const InvoiceSchema = z.object({
  title:    z.string().min(1),
  dealId:   z.string().optional().nullable(),
  notes:    z.string().optional().nullable(),
  dueDate:  z.string().optional().nullable(),
  taxRate:  z.coerce.number().min(0).max(100).default(0),
  lines:    z.array(LineSchema).min(1),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { dealId, status } = req.query as Record<string, string>;
    const where: any = { orgId: req.user!.orgId };
    if (dealId) where.dealId = dealId;
    if (status) where.status = status;
    const invoices = await prisma.invoice.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    res.json({ data: invoices });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { lines, ...data } = InvoiceSchema.parse(req.body);
    const invoiceNumber = await nextInvoiceNumber(orgId);
    const invoice = await prisma.invoice.create({
      data: {
        ...data,
        orgId,
        invoiceNumber,
        createdBy: req.user!.id,
        dealId: data.dealId ?? undefined,
        notes: data.notes ?? undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        lines: { create: lines },
      },
      include,
    });
    logAction(req.user!.id, 'CREATE', 'Invoice', invoice.id, { invoiceNumber });
    res.status(201).json(invoice);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include });
    if (!invoice) throw new AppError(404, 'Invoice not found');
    res.json(invoice);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { lines, ...data } = InvoiceSchema.partial().parse(req.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!invoice) throw new AppError(404, 'Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new AppError(400, `Cannot edit a ${invoice.status.toLowerCase()} invoice`);
    }

    if (lines) await prisma.invoiceLine.deleteMany({ where: { invoiceId: req.params.id } });
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        ...data,
        dealId: data.dealId ?? undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        ...(lines ? { lines: { create: lines } } : {}),
      },
      include,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

const StatusSchema = z.object({ status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID']) });

export async function changeStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = StatusSchema.parse(req.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!invoice) throw new AppError(404, 'Invoice not found');
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status, paidAt: status === 'PAID' ? new Date() : invoice.paidAt },
      include,
    });
    logAction(req.user!.id, 'UPDATE', 'Invoice', invoice.id, { status });
    // Automation hook — e.g. "notify finance when an invoice goes OVERDUE"
    // or "webhook the ERP when an invoice is PAID". previousEntity carries
    // the pre-change row so conditions can compare old vs new status.
    runWorkflows({ trigger: 'INVOICE_STATUS_CHANGED', orgId: req.user!.orgId, entityType: 'INVOICE', entityId: updated.id, entity: updated as any, previousEntity: invoice as any }).catch(() => {});
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // A PAID invoice is a financial record — update() already refuses to edit
    // one, but delete had no matching guard, so a paid invoice could vanish
    // without a trace (found by the deletion-verification sweep, 2026-08).
    // Void keeps the numbered record while marking it dead; deletion stays
    // available for drafts and mistakes that never reached "paid".
    const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!invoice) throw new AppError(404, 'Invoice not found');
    if (invoice.status === 'PAID') {
      throw new AppError(400, 'A paid invoice cannot be deleted — void it instead to keep the financial record.');
    }

    const { count } = await prisma.invoice.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('INVOICE', req.params.id, req.user!.orgId);
    res.json({ message: 'Invoice deleted' });
  } catch (err) { next(err); }
}

// ─── Public share link (mirrors quotes.controller.ts's pattern exactly) ────

function invoiceShareToken(invoiceId: string): string {
  // No hardcoded fallback — see quotes.controller.ts's quoteShareToken().
  const secret = process.env.QUOTE_SHARE_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new AppError(500, 'Server misconfigured: set QUOTE_SHARE_SECRET (or JWT_SECRET)');
  return crypto.createHmac('sha256', secret).update(`invoice:${invoiceId}`).digest('hex').slice(0, 32);
}

export async function getShareLink(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!invoice) throw new AppError(404, 'Invoice not found');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/invoice/${invoice.id}?t=${invoiceShareToken(invoice.id)}`;
    res.json({ link });
  } catch (err) { next(err); }
}

/** GET /invoices/public/:id?t=... — public, token-secured read-only view for the customer (print-to-PDF from there) */
export async function publicView(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const token = String(req.query.t || '');
    if (!token || token !== invoiceShareToken(id)) throw new AppError(404, 'Invoice not found');
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lines: true,
        org: { select: { name: true, currency: true, timezone: true } },
        deal: { select: { id: true, title: true } },
      },
    });
    if (!invoice) throw new AppError(404, 'Invoice not found');
    res.json(invoice);
  } catch (err) { next(err); }
}
