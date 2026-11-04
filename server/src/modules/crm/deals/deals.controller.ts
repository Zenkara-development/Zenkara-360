import { Response, NextFunction } from 'express';
import { runAiRules } from '../../../utils/ai-rules';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { sendMail, emailTemplates } from '../../../utils/mailer';
import { parsePagination, paginate } from '../../../utils/pagination';
import { runWorkflows } from '../../../utils/workflow-engine';
import { slackDealWon } from '../../../utils/slack';
import { logAction } from '../../../utils/auditLog';
import { ensureDefaultPipeline, normalizeStages } from '../pipelines/pipelines.service';
import { purgeEntityChildren } from '../../../utils/entityCleanup';
import { tagIdFilter } from '../../../utils/tagFilter';

const Schema = z.object({
  title: z.string().min(1),
  value: z.number().min(0).optional(),
  stage: z.string().optional(),
  probability: z.number().min(0).max(100).optional(),
  closeDate: z.string().optional(),
  // z.preprocess maps a stray `null` to '' before the existing empty-string
  // handling runs — the union below only ever accepted a real string or ''
  // and 400'd on null (e.g. "Expected string, received null"), which every
  // caller was expected to avoid by simply not sending the key. The AI
  // Command Bar's prefill path didn't always honor that (see
  // sanitizeNlCommandFields in utils/ai.ts), so this accepts null the same
  // as "not set" rather than relying on every caller to never send one.
  contactId: z.preprocess(v => (v === null ? '' : v), z.string().optional().or(z.literal(''))).transform(v => v || undefined),
  accountId: z.preprocess(v => (v === null ? '' : v), z.string().optional().or(z.literal(''))).transform(v => v || undefined),
  assignedTo: z.preprocess(v => (v === null ? '' : v), z.string().optional().or(z.literal(''))).transform(v => v || undefined),
  // Department credited with this deal — validated against the org's
  // Department list (HR Org Structure); '' clears it.
  departmentId: z.preprocess(v => (v === null ? '' : v), z.string().optional().or(z.literal(''))).transform(v => v || undefined),
  status: z.enum(['OPEN','WON','LOST']).optional(),
});

/** departmentId must belong to this org, or be undefined. */
async function assertDepartmentInOrg(departmentId: string | undefined, orgId: string) {
  if (!departmentId) return undefined;
  const dep = await prisma.department.findFirst({ where: { id: departmentId, orgId }, select: { id: true } });
  if (!dep) throw new AppError(400, 'Department not found in this organization');
  return dep.id;
}

const include = {
  contact: { select: { id: true, name: true, email: true } },
  account: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
  department: { select: { id: true, name: true } },
  pipeline: { select: { id: true, name: true, stages: true } },
};

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { status, stage, assignedTo, tagId, departmentId } = req.query as Record<string, string>;
    const pag = parsePagination(req);
    const where: any = { orgId };
    if (status) where.status = status;
    if (stage) where.stage = stage;
    if (assignedTo) where.assignedTo = assignedTo;
    if (departmentId) where.departmentId = departmentId;
    // ?tagId=a,b narrows to records carrying every listed tag. Merged
    // into `where` as an id set, since tags are polymorphic rather than
    // a relation on this model — see utils/tagFilter.ts.
    const byTag = await tagIdFilter(orgId, 'DEAL', tagId);
    if (byTag) Object.assign(where, byTag);
    const [deals, total] = await Promise.all([
      prisma.deal.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.deal.count({ where }),
    ]);
    res.json(paginate(deals, total, pag));
  } catch (err) { next(err); }
}

export async function pipeline(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const p = await ensureDefaultPipeline(orgId);
    const stages = normalizeStages(p.stages);
    const deals = await prisma.deal.findMany({ where: { orgId, status: 'OPEN' }, include, orderBy: { createdAt: 'desc' } });
    const grouped = stages.map(s => ({ stage: s.label, color: s.color, probability: s.probability, deals: deals.filter(d => d.stage === s.label) }));
    res.json({ pipeline: { ...p, stages }, columns: grouped });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = Schema.parse(req.body);
    const p = await ensureDefaultPipeline(orgId);
    const stages = normalizeStages(p.stages);
    const deal = await prisma.deal.create({
      data: {
        orgId,
        title: data.title,
        value: data.value ?? 0,
        stage: data.stage || stages[0]?.label,
        probability: data.probability ?? 20,
        closeDate: data.closeDate ? new Date(data.closeDate) : undefined,
        contactId: data.contactId,
        accountId: data.accountId,
        assignedTo: data.assignedTo || req.user!.id,
        departmentId: await assertDepartmentInOrg(data.departmentId, orgId),
        pipelineId: p.id,
      },
      include
    });
    await prisma.dealHistory.create({ data: { dealId: deal.id, toStage: deal.stage, changedBy: req.user!.id } });
    logAction(req.user!.id, 'CREATE', 'Deal', deal.id, { title: deal.title, value: Number(deal.value) });
    res.status(201).json(deal);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const deal = await prisma.deal.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: { ...include, history: { orderBy: { changedAt: 'desc' } }, activities: { orderBy: { createdAt: 'desc' }, include: { createdByUser: { select: { id: true, name: true } } } } }
    });
    if (!deal) throw new AppError(404, 'Deal not found');
    res.json(deal);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    const existing = await prisma.deal.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Deal not found');
    if (data.departmentId !== undefined) {
      (data as any).departmentId = await assertDepartmentInOrg(data.departmentId, req.user!.orgId);
    }
    await prisma.deal.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId }, data: { ...data, closeDate: data.closeDate ? new Date(data.closeDate) : undefined } });
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, include });
    if (data.status && data.status !== existing.status) {
      const trigger = data.status === 'WON' ? 'DEAL_WON' : data.status === 'LOST' ? 'DEAL_LOST' : null;
      if (trigger) runWorkflows({ trigger, orgId: req.user!.orgId, entityType: 'DEAL', entityId: deal!.id, entity: { ...(deal as any), departmentName: (deal as any)?.department?.name ?? null }, previousEntity: existing as any }).catch(() => {});
      if (data.status === 'WON' && deal) slackDealWon(req.user!.orgId, { title: deal.title, value: Number(deal.value), assignee: deal.assignee }).catch(() => {});
    }

    /* DEAL_STAGE_CHANGED only fired from moveStage(), so moving a deal from
       the edit form instead of the pipeline board silently skipped every
       stage automation — the same user action, two different outcomes
       depending on which screen it was done from. */
    if (data.stage && data.stage !== existing.stage && deal) {
      runWorkflows({
        trigger: 'DEAL_STAGE_CHANGED',
        orgId: req.user!.orgId,
        entityType: 'DEAL',
        entityId: deal.id,
        entity: { ...(deal as any), departmentName: (deal as any)?.department?.name ?? null },
        previousEntity: existing as any,
      }).catch(() => {});
      runAiRules({ trigger: 'DEAL_STAGE_CHANGED', orgId: req.user!.orgId, entityType: 'DEAL', entityId: deal.id, entity: { ...(deal as any), departmentName: (deal as any)?.department?.name ?? null }, userId: req.user!.id });
    }
    logAction(req.user!.id, 'UPDATE', 'Deal', req.params.id, data as Record<string, unknown>);
    res.json(deal);
  } catch (err) { next(err); }
}

export async function moveStage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { stage } = z.object({ stage: z.string() }).parse(req.body);
    const existing = await prisma.deal.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Deal not found');
    if (existing.pipelineId) {
      const p = await prisma.pipeline.findUnique({ where: { id: existing.pipelineId } });
      const validLabels = normalizeStages(p?.stages).map(s => s.label);
      if (validLabels.length && !validLabels.includes(stage)) {
        throw new AppError(400, `"${stage}" is not a stage on this deal's pipeline`);
      }
    }
    const deal = await prisma.deal.update({ where: { id: req.params.id }, data: { stage }, include });
    await prisma.dealHistory.create({ data: { dealId: deal.id, fromStage: existing.stage, toStage: stage, changedBy: req.user!.id } });
    if (deal.assignee?.email) {
      sendMail({ ...emailTemplates.dealStageChanged({ title: deal.title, stage }, deal.assignee.name, deal.assignee.email), orgId: req.user!.orgId }).catch(() => {});
    }
    runWorkflows({ trigger: 'DEAL_STAGE_CHANGED', orgId: req.user!.orgId, entityType: 'DEAL', entityId: deal.id, entity: { ...(deal as any), departmentName: (deal as any)?.department?.name ?? null }, previousEntity: existing as any }).catch(() => {});
    res.json(deal);
  } catch (err) { next(err); }
}

export async function reports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const p = await ensureDefaultPipeline(orgId);
    const stages = normalizeStages(p.stages).map(s => s.label);
    const deals = await prisma.deal.findMany({ where: { orgId, status: 'OPEN' } });
    const funnel = stages.map(stage => {
      const stageDeals = deals.filter(d => d.stage === stage);
      const value = stageDeals.reduce((sum, d) => sum + Number(d.value), 0);
      return { stage, count: stageDeals.length, value };
    });
    const won = await prisma.deal.count({ where: { orgId, status: 'WON' } });
    const lost = await prisma.deal.count({ where: { orgId, status: 'LOST' } });
    const forecast = deals.reduce((sum, d) => sum + (Number(d.value) * d.probability / 100), 0);
    res.json({ funnel, won, lost, forecast: Math.round(forecast) });
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.deal.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('DEAL', req.params.id, req.user!.orgId);
    logAction(req.user!.id, 'DELETE', 'Deal', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
