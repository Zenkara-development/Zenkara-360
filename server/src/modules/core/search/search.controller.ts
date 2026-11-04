import { Response, NextFunction } from 'express';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { interpretSearchQuery, isAiConfigured } from '../../../utils/ai';

/**
 * Normalizes an AI-extracted status/priority word (e.g. "open", "critical",
 * "won") against a model's actual enum values. Returns null — filter simply
 * not applied — rather than guessing, if nothing matches; a wrong filter
 * would silently hide results, which is worse than not filtering at all.
 */
function matchEnum(hint: string | null, values: readonly string[]): string | null {
  if (!hint) return null;
  const normalized = hint.trim().toUpperCase().replace(/\s+/g, '_');
  // Compares case-insensitively but returns the value in its *original*
  // casing from the list — Ticket/Deal/Lead statuses are UPPER_SNAKE enums,
  // but Asset.status is a lowercase string column, so the candidate list
  // itself carries the casing that actually needs to hit the DB.
  return values.find(v => v.toUpperCase() === normalized) ?? null;
}

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'] as const;
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const DEAL_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'] as const;
const ASSET_STATUSES = ['active', 'inactive', 'retired', 'in_repair'] as const;
const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID'] as const;

export async function search(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) return res.json({ contacts: [], deals: [], tickets: [], leads: [], articles: [], assets: [], invoices: [], aiPowered: false });

    const orgId = req.user!.orgId;
    const mode = 'insensitive' as const;
    const aiPowered = isAiConfigured();

    // interpretSearchQuery() is a no-op passthrough when no AI provider is
    // configured (returns the raw query, all entity types, no filters) — so
    // this is always safe to call, and the search never regresses to worse
    // than the old plain-substring behavior.
    const interpretation = await interpretSearchQuery(q);
    const term = interpretation.keywords || q;
    const wantAll = interpretation.entityTypes.length === 0;
    const wants = (type: string) => wantAll || interpretation.entityTypes.includes(type);

    const ticketStatus = matchEnum(interpretation.status, TICKET_STATUSES);
    const ticketPriority = matchEnum(interpretation.priority, TICKET_PRIORITIES);
    const dealStatus = matchEnum(interpretation.status, DEAL_STATUSES);
    const leadStatus = matchEnum(interpretation.status, LEAD_STATUSES);
    const assetStatus = matchEnum(interpretation.status, ASSET_STATUSES);
    const invoiceStatus = matchEnum(interpretation.status, INVOICE_STATUSES);

    const [contacts, deals, tickets, leads, articles, assets, invoices] = await Promise.all([
      wants('contact')
        ? prisma.contact.findMany({
            where: { orgId, OR: [{ name: { contains: term, mode } }, { email: { contains: term, mode } }] },
            select: { id: true, name: true, email: true, jobTitle: true },
            take: 5,
          })
        : Promise.resolve([]),
      wants('deal')
        ? prisma.deal.findMany({
            where: { orgId, title: { contains: term, mode }, ...(dealStatus ? { status: dealStatus as any } : {}) },
            select: { id: true, title: true, stage: true, value: true, status: true },
            take: 5,
          })
        : Promise.resolve([]),
      wants('ticket')
        ? prisma.ticket.findMany({
            where: {
              orgId,
              OR: [{ title: { contains: term, mode } }, { body: { contains: term, mode } }],
              ...(ticketStatus ? { status: ticketStatus as any } : {}),
              ...(ticketPriority ? { priority: ticketPriority as any } : {}),
            },
            select: { id: true, title: true, status: true, priority: true },
            take: 5,
          })
        : Promise.resolve([]),
      wants('lead')
        ? prisma.lead.findMany({
            where: { orgId, contact: { name: { contains: term, mode } }, ...(leadStatus ? { status: leadStatus as any } : {}) },
            select: { id: true, status: true, source: true, contact: { select: { name: true, email: true } } },
            take: 5,
          })
        : Promise.resolve([]),
      wants('article')
        ? prisma.knowledgeArticle.findMany({
            where: { orgId, status: 'PUBLISHED', OR: [{ title: { contains: term, mode } }, { body: { contains: term, mode } }] },
            select: { id: true, title: true, status: true },
            take: 5,
          })
        : Promise.resolve([]),
      wants('asset')
        ? prisma.asset.findMany({
            where: { orgId, ...(assetStatus ? { status: assetStatus } : {}), OR: [{ name: { contains: term, mode } }, { serialNumber: { contains: term, mode } }] },
            select: { id: true, name: true, type: true, status: true, serialNumber: true },
            take: 5,
          })
        : Promise.resolve([]),
      wants('invoice')
        ? prisma.invoice.findMany({
            where: { orgId, ...(invoiceStatus ? { status: invoiceStatus } : {}), OR: [{ title: { contains: term, mode } }, { invoiceNumber: { contains: term, mode } }] },
            select: { id: true, title: true, invoiceNumber: true, status: true },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    res.json({ contacts, deals, tickets, leads, articles, assets, invoices, aiPowered });
  } catch (err) { next(err); }
}
