import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { runDateRuleNow } from '../../utils/dateAutomation';

// Only present (and required) when trigger === 'DATE_FIELD_REACHED'. See
// utils/dateAutomation.ts's DateConfig for the runtime shape this mirrors.
const DateConfigSchema = z.object({
  entityType: z.enum(['CONTACT', 'DEAL', 'TICKET', 'LEAD', 'CUSTOM_MODULE']),
  moduleId: z.string().optional(),
  dateField: z.string().min(1),
  offsetDays: z.number().int(),
  recurrence: z.enum(['ONCE', 'YEARLY']),
}).refine(
  (d) => d.entityType !== 'CUSTOM_MODULE' || !!d.moduleId,
  { message: 'moduleId is required when entityType is CUSTOM_MODULE' },
);

const RuleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  trigger: z.enum([
    'TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_STATUS_CHANGED',
    'LEAD_CREATED', 'LEAD_STATUS_CHANGED', 'LEAD_ACTIVITY_COMPLETED',
    'DEAL_STAGE_CHANGED', 'DEAL_WON', 'DEAL_LOST',
    'SLA_BREACH', 'DATE_FIELD_REACHED',
    // Newer-module coverage — keep in step with WorkflowTrigger in
    // utils/workflow-engine.ts AND the trigger picker in the client's
    // AutomationPage; a value present in only one layer either 400s on save
    // or can never fire.
    'CUSTOM_RECORD_CREATED', 'CUSTOM_RECORD_STAGE_CHANGED', 'INVOICE_STATUS_CHANGED', 'QUOTE_STATUS_CHANGED',
    'CSAT_RECEIVED', 'APPROVAL_DECIDED', 'LEAVE_REQUESTED',
  ]),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(['eq', 'neq', 'gt', 'lt', 'contains', 'in']),
    value: z.union([z.string(), z.number(), z.array(z.string())]),
  })),
  actions: z.array(z.object({
    // Every type accepted here must also exist in workflow-engine.ts's
    // Action['type'] union AND its executeAction() switch — this schema
    // gates the create/update endpoint, the union gates the TS call site,
    // and the switch is what actually runs. A type present in only one or
    // two of the three either 400s on save or silently no-ops at runtime
    // (see CREATE_TICKET/SCORE_LEAD, which used to drift between these).
    type: z.enum(['ASSIGN_TO', 'SET_PRIORITY', 'SET_STATUS', 'SEND_EMAIL', 'SEND_WHATSAPP', 'ADD_NOTE', 'SEND_WEBHOOK', 'SCORE_LEAD', 'AI_AUTO_ASSIGN', 'CREATE_TICKET', 'CREATE_NOTIFICATION', 'SEND_CSAT_SURVEY']),
    params: z.record(z.union([z.string(), z.number()])),
  })),
  isActive: z.boolean().default(true),
  // Left as plain .optional() (no .nullable()) — Prisma needs Prisma.JsonNull
  // rather than a plain `null` to actually clear a Json column, which isn't
  // worth wiring up for this edge case: if a rule's trigger is switched away
  // from DATE_FIELD_REACHED, the poller only ever reads rules whose trigger
  // *is* DATE_FIELD_REACHED, so a stale dateConfig left behind is inert.
  dateConfig: DateConfigSchema.optional(),
});
// A .refine() wrapper loses .partial() (needed by update() below, since PUT
// requests only send changed fields) — so the "dateConfig required when
// trigger is DATE_FIELD_REACHED" cross-field check lives here instead, kept
// as a plain object schema plus a manual check in create()/update().
function assertDateConfigPresent(data: { trigger: string; dateConfig?: unknown }) {
  if (data.trigger === 'DATE_FIELD_REACHED' && !data.dateConfig) {
    throw new AppError(400, 'dateConfig is required when trigger is DATE_FIELD_REACHED');
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const rules = await prisma.workflowRule.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { logs: true } } },
    });
    res.json(rules);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = RuleSchema.parse(req.body);
    assertDateConfigPresent(data);
    const rule = await prisma.workflowRule.create({ data: { ...data, orgId } });
    res.status(201).json(rule);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;
    const data = RuleSchema.partial().parse(req.body);
    const rule = await prisma.workflowRule.findFirst({ where: { id, orgId } });
    if (!rule) throw new AppError(404, 'Rule not found');
    assertDateConfigPresent({
      trigger: data.trigger ?? rule.trigger,
      dateConfig: 'dateConfig' in data ? data.dateConfig : rule.dateConfig,
    });
    const updated = await prisma.workflowRule.update({ where: { id }, data });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;
    await prisma.workflowRule.deleteMany({ where: { id, orgId } });
    res.json({ message: 'Rule deleted' });
  } catch (err) { next(err); }
}

export async function getLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;
    const rule = await prisma.workflowRule.findFirst({ where: { id, orgId } });
    if (!rule) throw new AppError(404, 'Rule not found');
    const logs = await prisma.workflowLog.findMany({
      where: { ruleId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(logs);
  } catch (err) { next(err); }
}

export async function toggleActive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;
    const rule = await prisma.workflowRule.findFirst({ where: { id, orgId } });
    if (!rule) throw new AppError(404, 'Rule not found');
    const updated = await prisma.workflowRule.update({ where: { id }, data: { isActive: !rule.isActive } });
    res.json(updated);
  } catch (err) { next(err); }
}

/** "Run now" test button for DATE_FIELD_REACHED rules — see runDateRuleNow's doc comment. */
export async function runDateRule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;
    // Preview unless the caller explicitly opts into sending. The client asks
    // for confirmation between the two.
    const dryRun = req.body?.dryRun !== false;
    const { matched } = await runDateRuleNow(id, orgId, { dryRun });

    const message = matched === 0
      ? 'No records match this rule today'
      : dryRun
        ? `${matched} record(s) match — nothing was sent`
        : `Ran for ${matched} matching record(s)`;

    // `fired` kept for older clients; it is 0 on a preview because nothing ran.
    res.json({ message, matched, dryRun, fired: dryRun ? 0 : matched });
  } catch (err: any) {
    next(new AppError(400, err?.message || 'Failed to run rule'));
  }
}
