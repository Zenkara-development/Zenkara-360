/**
 * Universal related-records view — "everything under this record".
 *
 *   GET /api/related/:entityType/:id     entityType: CONTACT | ACCOUNT | DEAL | TICKET
 *
 * One endpoint the record detail pages call to render their 360° panel:
 * a contact answers with its leads, deals, tickets, quotes/invoices (via its
 * deals), and every custom-module record whose RELATION field points at it;
 * an account with its contacts and deals; a deal with its quotes, invoices
 * and leads; a ticket with its time entries' summary and custom records.
 * Each group is shaped the same — { key, label, route, records[] } with
 * records as { id, title, subtitle?, badge? } — so the client component is
 * one renderer, not four.
 */
import { Response, NextFunction } from 'express';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { recordTitle } from '../../custom-modules/customModules.service';

interface RelatedRecord { id: string; title: string; subtitle?: string; badge?: string }
interface RelatedGroup { key: string; label: string; route: string; records: RelatedRecord[] }

const TAKE = 25;

/** Custom-module records whose RELATION field targets this core record. */
async function customRecordGroups(orgId: string, entity: string, recordId: string): Promise<RelatedGroup[]> {
  const inbound = await prisma.customModuleField.findMany({
    where: { relationEntity: entity, fieldType: 'RELATION', module: { orgId, isActive: true } },
    include: { module: { select: { id: true, name: true, slug: true, stages: true } } },
  });
  const groups: RelatedGroup[] = [];
  for (const f of inbound) {
    const rows = await prisma.customModuleRecord.findMany({
      where: { moduleId: f.moduleId, orgId, data: { path: [f.fieldKey], equals: recordId } },
      orderBy: { createdAt: 'desc' }, take: TAKE,
    });
    if (!rows.length) continue;
    const fields = await prisma.customModuleField.findMany({ where: { moduleId: f.moduleId }, orderBy: { position: 'asc' } });
    const stages = Array.isArray(f.module.stages) ? (f.module.stages as any[]) : [];
    groups.push({
      key: `module:${f.module.slug}:${f.fieldKey}`,
      label: f.module.name,
      route: `/modules/${f.module.slug}`,
      records: rows.map(r => ({
        id: r.id,
        title: recordTitle(fields, r.data as Record<string, unknown>, r.id),
        subtitle: `via ${f.label}`,
        badge: r.stage ? (stages.find(s => s.key === r.stage)?.label ?? r.stage) : undefined,
      })),
    });
  }
  return groups;
}

export async function relatedForEntity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const entity = String(req.params.entityType || '').toUpperCase();
    const id = req.params.id;
    const groups: RelatedGroup[] = [];

    if (entity === 'CONTACT') {
      const contact = await prisma.contact.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!contact) throw new AppError(404, 'Contact not found');
      const [leads, deals, tickets] = await Promise.all([
        prisma.lead.findMany({ where: { contactId: id, orgId }, select: { id: true, status: true, source: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: TAKE }),
        prisma.deal.findMany({ where: { contactId: id, orgId }, select: { id: true, title: true, stage: true, value: true }, orderBy: { createdAt: 'desc' }, take: TAKE }),
        prisma.ticket.findMany({ where: { contactId: id, orgId }, select: { id: true, title: true, status: true, priority: true }, orderBy: { createdAt: 'desc' }, take: TAKE }),
      ]);
      // Quotes/invoices hang off deals, not contacts — follow the chain so
      // the contact still shows the money documents their deals produced.
      const dealIds = deals.map(d => d.id);
      const [quotes, invoices] = dealIds.length ? await Promise.all([
        prisma.quote.findMany({ where: { dealId: { in: dealIds }, orgId }, select: { id: true, title: true, status: true }, take: TAKE }),
        prisma.invoice.findMany({ where: { dealId: { in: dealIds }, orgId }, select: { id: true, invoiceNumber: true, title: true, status: true }, take: TAKE }),
      ]) : [[], []];

      if (leads.length) groups.push({ key: 'leads', label: 'Leads', route: '/crm/leads', records: leads.map(l => ({ id: l.id, title: l.source ? `Lead — ${l.source}` : 'Lead', badge: l.status })) });
      if (deals.length) groups.push({ key: 'deals', label: 'Deals', route: '/crm/deals', records: deals.map(d => ({ id: d.id, title: d.title, subtitle: d.value ? String(d.value) : undefined, badge: d.stage })) });
      if (tickets.length) groups.push({ key: 'tickets', label: 'Tickets', route: '/itdesk/tickets', records: tickets.map(t => ({ id: t.id, title: t.title, badge: t.status })) });
      if (quotes.length) groups.push({ key: 'quotes', label: 'Quotes', route: '/quotes', records: quotes.map(q => ({ id: q.id, title: q.title, badge: q.status, subtitle: 'via deal' })) });
      if (invoices.length) groups.push({ key: 'invoices', label: 'Invoices', route: '/invoices', records: invoices.map(i => ({ id: i.id, title: `${i.invoiceNumber} — ${i.title}`, badge: i.status, subtitle: 'via deal' })) });
    } else if (entity === 'ACCOUNT') {
      const account = await prisma.account.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!account) throw new AppError(404, 'Account not found');
      const [contacts, deals] = await Promise.all([
        prisma.contact.findMany({ where: { accountId: id, orgId }, select: { id: true, name: true, jobTitle: true }, take: TAKE }),
        prisma.deal.findMany({ where: { accountId: id, orgId }, select: { id: true, title: true, stage: true }, take: TAKE }),
      ]);
      if (contacts.length) groups.push({ key: 'contacts', label: 'Contacts', route: '/crm/contacts', records: contacts.map(c => ({ id: c.id, title: c.name, subtitle: c.jobTitle ?? undefined })) });
      if (deals.length) groups.push({ key: 'deals', label: 'Deals', route: '/crm/deals', records: deals.map(d => ({ id: d.id, title: d.title, badge: d.stage })) });
    } else if (entity === 'DEAL') {
      const deal = await prisma.deal.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!deal) throw new AppError(404, 'Deal not found');
      const [quotes, invoices, leads] = await Promise.all([
        prisma.quote.findMany({ where: { dealId: id, orgId }, select: { id: true, title: true, status: true }, take: TAKE }),
        prisma.invoice.findMany({ where: { dealId: id, orgId }, select: { id: true, invoiceNumber: true, title: true, status: true }, take: TAKE }),
        prisma.lead.findMany({ where: { dealId: id, orgId }, select: { id: true, status: true, source: true }, take: TAKE }),
      ]);
      if (quotes.length) groups.push({ key: 'quotes', label: 'Quotes', route: '/quotes', records: quotes.map(q => ({ id: q.id, title: q.title, badge: q.status })) });
      if (invoices.length) groups.push({ key: 'invoices', label: 'Invoices', route: '/invoices', records: invoices.map(i => ({ id: i.id, title: `${i.invoiceNumber} — ${i.title}`, badge: i.status })) });
      if (leads.length) groups.push({ key: 'leads', label: 'Converted from leads', route: '/crm/leads', records: leads.map(l => ({ id: l.id, title: l.source ? `Lead — ${l.source}` : 'Lead', badge: l.status })) });
    } else if (entity === 'TICKET') {
      const ticket = await prisma.ticket.findFirst({ where: { id, orgId }, select: { id: true, contactId: true } });
      if (!ticket) throw new AppError(404, 'Ticket not found');
      if (ticket.contactId) {
        const contact = await prisma.contact.findFirst({ where: { id: ticket.contactId, orgId }, select: { id: true, name: true, jobTitle: true } });
        if (contact) groups.push({ key: 'contact', label: 'Contact', route: '/crm/contacts', records: [{ id: contact.id, title: contact.name, subtitle: contact.jobTitle ?? undefined }] });
      }
    } else {
      throw new AppError(400, 'entityType must be CONTACT, ACCOUNT, DEAL or TICKET');
    }

    // Custom-module records pointing at this record, for every entity type.
    groups.push(...await customRecordGroups(orgId, entity, id));

    res.json({ groups });
  } catch (err) { next(err); }
}
