import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { parsePagination, paginate } from '../../../utils/pagination';
import { runWorkflows } from '../../../utils/workflow-engine';
import { slackNewLead } from '../../../utils/slack';
import { logAction } from '../../../utils/auditLog';
import { ensureDefaultPipeline, normalizeStages } from '../pipelines/pipelines.service';
import { purgeEntityChildren } from '../../../utils/entityCleanup';
import { tagIdFilter } from '../../../utils/tagFilter';

const Schema = z.object({
  contactId: z.string().optional().or(z.literal('')).transform(v => v || undefined),
  source: z.string().optional(),
  status: z.enum(['NEW','CONTACTED','QUALIFIED','UNQUALIFIED','CONVERTED']).optional(),
  assignedTo: z.string().optional().or(z.literal('')).transform(v => v || undefined),
  notes: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  // Which department works this lead — validated against the org's
  // Department list (HR Org Structure) below; '' clears it.
  departmentId: z.string().optional().or(z.literal('')).transform(v => v || undefined),
});

const include = {
  contact: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { activities: true } },
};

/** departmentId must belong to this org, or be undefined. */
async function assertDepartmentInOrg(departmentId: string | undefined, orgId: string) {
  if (!departmentId) return undefined;
  const dep = await prisma.department.findFirst({ where: { id: departmentId, orgId }, select: { id: true } });
  if (!dep) throw new AppError(400, 'Department not found in this organization');
  return dep.id;
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { status, search, tagId, departmentId } = req.query as Record<string, string>;
    const pag = parsePagination(req);
    const where: any = { orgId };
    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;
    if (search) where.contact = { name: { contains: search, mode: 'insensitive' } };
    // ?tagId=a,b narrows to records carrying every listed tag. Merged
    // into `where` as an id set, since tags are polymorphic rather than
    // a relation on this model — see utils/tagFilter.ts.
    const byTag = await tagIdFilter(orgId, 'LEAD', tagId);
    if (byTag) Object.assign(where, byTag);
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.lead.count({ where }),
    ]);
    res.json(paginate(leads, total, pag));
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.parse(req.body);
    const orgId = req.user!.orgId;
    let contactId = data.contactId;
    if (!contactId && data.name) {
      const contact = await prisma.contact.create({
        data: { name: data.name, email: data.email, source: data.source, orgId, ownerId: req.user!.id }
      });
      contactId = contact.id;
    }
    const departmentId = await assertDepartmentInOrg(data.departmentId, orgId);
    const lead = await prisma.lead.create({
      data: { contactId, source: data.source, assignedTo: data.assignedTo || req.user!.id, notes: data.notes, departmentId, orgId },
      include
    });
    // departmentName flattened for rule conditions ("departmentName equals Sales").
    runWorkflows({ trigger: 'LEAD_CREATED', orgId, entityType: 'LEAD', entityId: lead.id, entity: { ...(lead as any), departmentName: (lead as any).department?.name ?? null } }).catch(() => {});
    slackNewLead(orgId, { id: lead.id, contact: lead.contact, source: lead.source }).catch(() => {});
    logAction(req.user!.id, 'CREATE', 'Lead', lead.id, { contactId: lead.contactId, source: lead.source });
    res.status(201).json(lead);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: { ...include, activities: { orderBy: [{ done: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }], include: { createdByUser: { select: { id: true, name: true } } } } },
    });
    if (!lead) throw new AppError(404, 'Lead not found');
    res.json(lead);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, email, ...leadData } = Schema.partial().parse(req.body);
    const orgId = req.user!.orgId;
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Lead not found');

    // `name`/`email` belong to the linked Contact, not the Lead itself — the
    // Lead model has no such columns, so passing them straight into
    // lead.updateMany() throws "Unknown argument" and the whole update fails
    // (the edit modal then never closes, since it only closes after the
    // mutation resolves). Apply them to the Contact instead, same as create().
    if ((name !== undefined || email !== undefined) && existing.contactId) {
      await prisma.contact.update({
        where: { id: existing.contactId },
        data: { ...(name !== undefined && { name }), ...(email !== undefined && { email }) },
      });
    }

    if (leadData.departmentId !== undefined) {
      (leadData as any).departmentId = await assertDepartmentInOrg(leadData.departmentId, orgId);
    }
    await prisma.lead.updateMany({ where: { id: req.params.id, orgId }, data: leadData });
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include });
    if (leadData.status && leadData.status !== existing.status && lead) {
      runWorkflows({ trigger: 'LEAD_STATUS_CHANGED', orgId, entityType: 'LEAD', entityId: lead.id, entity: { ...(lead as any), departmentName: (lead as any)?.department?.name ?? null }, previousEntity: existing as any }).catch(() => {});
    }
    logAction(req.user!.id, 'UPDATE', 'Lead', req.params.id, leadData as Record<string, unknown>);
    res.json(lead);
  } catch (err) { next(err); }
}

export async function convert(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, orgId }, include });
    if (!lead) throw new AppError(404, 'Lead not found');
    if (lead.status === 'CONVERTED') throw new AppError(400, 'Lead already converted');

    const { dealTitle, dealValue, dealStage, dealProbability } = req.body;

    const pipeline = await ensureDefaultPipeline(orgId);
    const stages = normalizeStages(pipeline.stages);
    const deal = await prisma.deal.create({
      data: {
        orgId,
        title: dealTitle || `Deal - ${lead.contact?.name || 'New Deal'}`,
        stage: dealStage || stages[0]?.label,
        value: dealValue ? Number(dealValue) : undefined,
        probability: dealProbability ? Number(dealProbability) : (stages[0]?.probability ?? 20),
        pipelineId: pipeline.id,
        contactId: lead.contactId ?? undefined,
        assignedTo: req.user!.id,
        // The deal inherits the lead's department — the same team that
        // worked the lead owns the resulting opportunity.
        departmentId: lead.departmentId ?? undefined,
      }
    });
    await prisma.dealHistory.create({ data: { dealId: deal.id, toStage: deal.stage, changedBy: req.user!.id } });

    const updated = await prisma.lead.update({
      where: { id: req.params.id },
      data: { status: 'CONVERTED', convertedAt: new Date(), dealId: deal.id },
      include
    });
    runWorkflows({ trigger: 'LEAD_STATUS_CHANGED', orgId, entityType: 'LEAD', entityId: updated.id, entity: { ...(updated as any), departmentName: (updated as any)?.department?.name ?? null }, previousEntity: lead as any }).catch(() => {});
    logAction(req.user!.id, 'UPDATE', 'Lead', updated.id, { converted: true, dealId: deal.id });
    res.json({ lead: updated, deal });
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.lead.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('LEAD', req.params.id, req.user!.orgId);
    logAction(req.user!.id, 'DELETE', 'Lead', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
