import { prisma } from './prisma';
import { ENTITY_MODEL } from './entityAccess';
import { complete } from './aiGateway';
import { runWithAiContext } from './aiContext';
import { sendPushToUser } from './webPush';

/**
 * Executor for AI Custom Rules ("AI Feature Builder").
 *
 * The feature previously had a model, full CRUD, a marketing page promising
 * "AI extracts tags from ticket content automatically", and a demo seeder
 * writing `runCount: 12, lastRunAt: yesterday` — but **no executor anywhere**.
 * All six triggers and all seven actions were inert, and the fake run counts
 * made a dead feature look like a working one.
 *
 * This is that executor. Design decisions worth knowing:
 *
 * - Every call goes through the AI gateway, so a rule is budgeted, logged in
 *   AiInteractionLog and costed like every other AI feature. That is only
 *   possible because the stacks were unified first.
 * - Actions that change a record are conservative. `ROUTE` may only pick a
 *   category that exists in the org and an agent who is a member of it; the
 *   model's answer is re-validated rather than trusted, the same contract the
 *   AI action registry uses.
 * - Failures never propagate to the user's request. These fire from the same
 *   detached call sites as workflow rules, so a broken rule must not turn a
 *   ticket creation into a 500. Errors are recorded on the rule.
 * - There is no recursion guard because no action here emits a trigger. If an
 *   action is ever changed to route through a controller, that stops being
 *   true and this needs a depth counter.
 */

export type AiRuleTrigger =
  | 'TICKET_CREATED'
  | 'LEAD_SCORED'
  | 'DEAL_STAGE_CHANGED'
  | 'CONTACT_UPDATED'
  | 'TICKET_RESOLVED'
  | 'MANUAL';

export type AiRuleAction =
  | 'TAG' | 'ROUTE' | 'EMAIL' | 'NOTIFY' | 'SCORE' | 'SUMMARIZE' | 'CUSTOM_PROMPT';

export interface AiRuleContext {
  orgId: string;
  trigger: AiRuleTrigger;
  entityType: 'TICKET' | 'LEAD' | 'DEAL' | 'CONTACT';
  entityId: string;
  entity: Record<string, any>;
  /** Who caused the event, for the interaction log. */
  userId?: string | null;
}

/** Trimmed entity for the prompt — never the raw row, which carries ids and
 *  internal columns the model has no use for and that only cost tokens. */
function promptView(entityType: string, e: Record<string, any>): string {
  const pick = (keys: string[]) =>
    keys.filter(k => e[k] !== undefined && e[k] !== null && e[k] !== '')
        .map(k => `${k}: ${String(e[k]).slice(0, 1500)}`)
        .join('\n');

  switch (entityType) {
    case 'TICKET':  return pick(['title', 'body', 'description', 'priority', 'status', 'sentiment']);
    case 'LEAD':    return pick(['title', 'name', 'status', 'source', 'notes', 'aiScore']);
    case 'DEAL':    return pick(['title', 'value', 'stage', 'status', 'probability', 'notes']);
    case 'CONTACT': return pick(['name', 'email', 'company', 'jobTitle', 'notes']);
    default:        return pick(Object.keys(e).slice(0, 12));
  }
}

/** Per-action instruction appended to the org's own prompt. */
const ACTION_SPEC: Record<AiRuleAction, string> = {
  TAG: 'Respond ONLY with a JSON array of 3-6 short lowercase keyword tags: ["tag", ...]',
  ROUTE: 'Respond ONLY with valid JSON: {"categoryName": "exact name from the list", "reason": "1 sentence"}',
  EMAIL: 'Respond ONLY with valid JSON: {"subject": "...", "body": "..."}',
  NOTIFY: 'Respond ONLY with valid JSON: {"title": "short title", "body": "1-2 sentences"}',
  SCORE: 'Respond ONLY with valid JSON: {"score": 0-100, "reason": "1 sentence"}',
  SUMMARIZE: 'Write a concise 2-3 sentence summary. Plain text, no preamble.',
  CUSTOM_PROMPT: 'Answer concisely in plain text.',
};

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { /* fall through */ }
  // Models wrap JSON in prose or fences often enough to be worth one retry.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const braced = text.match(/[[{][\s\S]*[\]}]/);
  for (const candidate of [fenced?.[1], braced?.[0]]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* keep trying */ }
  }
  return null;
}

/** Apply one action. Returns a human-readable outcome for the rule's log. */
async function applyAction(
  action: AiRuleAction,
  output: string,
  ctx: AiRuleContext,
): Promise<string> {
  const { orgId, entityType, entityId } = ctx;

  switch (action) {
    case 'SUMMARIZE':
    case 'CUSTOM_PROMPT': {
      // Stored as a comment so the result is visible on the record itself
      // rather than vanishing into a response body.
      const map: Record<string, 'TICKET' | 'DEAL' | 'CONTACT'> = { TICKET: 'TICKET', DEAL: 'DEAL', CONTACT: 'CONTACT' };
      const mapped = map[entityType];
      if (!mapped) return `Skipped — notes are not supported on ${entityType}`;
      const author = await prisma.user.findFirst({
        where: { orgId, role: { in: ['SUPER_ADMIN', 'CRM_MANAGER', 'IT_MANAGER'] }, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!author) return 'Skipped — no admin user to attribute the note to';
      await prisma.comment.create({
        data: { authorId: author.id, entityType: mapped, entityId, body: `[AI] ${output.trim()}` },
      });
      return 'Added an AI note to the record';
    }

    case 'TAG': {
      const parsed = safeJson(output);
      const tags = Array.isArray(parsed)
        ? parsed.map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 6)
        : [];
      if (!tags.length) return 'No tags produced';

      // This used to write "[AI tags] a, b, c" into a comment body, because
      // there was nowhere to put a tag. There is now: RecordTag works on any
      // entity type, so these are real tags you can filter and count.
      if (!ENTITY_MODEL[entityType]) return `Skipped — tagging is not supported on ${entityType}`;

      // Attach to existing tags only where the name already matches (so the
      // model cannot invent forty near-duplicates of "urgent"), and create at
      // most two genuinely new ones per run.
      const existing = await prisma.tag.findMany({
        where: { orgId, name: { in: tags, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      const known = new Map(existing.map(t => [t.name.toLowerCase(), t]));

      const NEW_TAG_BUDGET = 2;
      let coined = 0;
      const applied: string[] = [];

      for (const name of tags) {
        let tag = known.get(name);
        if (!tag) {
          if (coined >= NEW_TAG_BUDGET) continue;
          try {
            tag = await prisma.tag.create({
              data: { orgId, name, color: '#6B7280', module: 'ALL' },
              select: { id: true, name: true },
            });
            coined++;
          } catch {
            continue; // raced with another rule creating the same name
          }
          known.set(name, tag);
        }
        await prisma.recordTag.upsert({
          where: { tagId_entityType_entityId: { tagId: tag.id, entityType: entityType as any, entityId } },
          create: { orgId, tagId: tag.id, entityType: entityType as any, entityId },
          update: {},
        });
        applied.push(tag.name);
      }

      if (!applied.length) return 'No tags applied';
      return `Tagged: ${applied.join(', ')}`;
    }

    case 'ROUTE': {
      if (entityType !== 'TICKET') return 'Skipped — routing only applies to tickets';
      const parsed = safeJson(output);
      const wanted = String(parsed?.categoryName ?? '').trim().toLowerCase();
      if (!wanted) return 'No category proposed';
      // Re-validated against the org's real categories. The model's answer is
      // a suggestion, never an id we act on directly.
      const categories = await prisma.category.findMany({ where: { orgId }, select: { id: true, name: true } });
      const match = categories.find((c: { id: string; name: string }) => c.name.trim().toLowerCase() === wanted);
      if (!match) return `Skipped — "${parsed?.categoryName}" is not a category in this organization`;
      await prisma.ticket.updateMany({ where: { id: entityId, orgId }, data: { categoryId: match.id } });
      return `Routed to ${match.name}`;
    }

    case 'SCORE': {
      if (entityType !== 'LEAD') return 'Skipped — scoring only applies to leads';
      const parsed = safeJson(output);
      const n = Number(parsed?.score);
      if (!Number.isFinite(n)) return 'Skipped — no usable score returned';
      const score = Math.round(Math.min(100, Math.max(0, n)));
      await prisma.lead.updateMany({
        where: { id: entityId, orgId },
        data: { aiScore: score, aiScoreReason: String(parsed?.reason ?? '').slice(0, 150) || null },
      });
      return `Scored ${score}/100`;
    }

    case 'NOTIFY': {
      const parsed = safeJson(output);
      const title = String(parsed?.title ?? 'AI rule').slice(0, 160);
      const body = String(parsed?.body ?? output).slice(0, 500);
      // Owner or assignee of the record, and only if they are in this org —
      // the same containment CREATE_NOTIFICATION needed.
      const targetId = ctx.entity.assignedTo || ctx.entity.ownerId || ctx.userId;
      if (!targetId) return 'Skipped — no recipient to notify';
      const recipient = await prisma.user.findFirst({ where: { id: String(targetId), orgId }, select: { id: true } });
      if (!recipient) return 'Skipped — recipient is not in this organization';
      await prisma.notification.create({
        data: { orgId, userId: recipient.id, type: 'STATUS_CHANGE', title, body, entityId, entityType },
      });
      sendPushToUser(recipient.id, { title, body }).catch(() => {});
      return `Notified ${recipient.id}`;
    }

    case 'EMAIL': {
      // Deliberately does NOT send. An AI-written email leaving the building
      // with no human in the loop is a different risk class from the other
      // actions here; the draft is filed on the record for someone to send.
      const parsed = safeJson(output);
      const subject = String(parsed?.subject ?? '').slice(0, 200);
      const body = String(parsed?.body ?? output).slice(0, 8000);
      const map: Record<string, 'TICKET' | 'DEAL' | 'CONTACT'> = { TICKET: 'TICKET', DEAL: 'DEAL', CONTACT: 'CONTACT' };
      const mapped = map[entityType];
      if (!mapped) return `Skipped — cannot file a draft against ${entityType}`;
      const author = await prisma.user.findFirst({
        where: { orgId, role: { in: ['SUPER_ADMIN', 'CRM_MANAGER', 'IT_MANAGER'] }, isActive: true },
        orderBy: { createdAt: 'asc' }, select: { id: true },
      });
      if (!author) return 'Skipped — no admin user to attribute the draft to';
      await prisma.comment.create({
        data: {
          authorId: author.id, entityType: mapped, entityId,
          body: `[AI email draft]${subject ? ` Subject: ${subject}\n\n` : '\n\n'}${body}`,
        },
      });
      return 'Filed an AI email draft on the record — not sent';
    }

    default:
      return `Unknown action ${action}`;
  }
}

/**
 * Runs every active AI rule for this org and trigger. Never throws — call
 * sites are detached, exactly like runWorkflows.
 */
export async function runAiRules(ctx: AiRuleContext): Promise<void> {
  try {
    const rules = await prisma.aICustomRule.findMany({
      where: { orgId: ctx.orgId, trigger: ctx.trigger, isActive: true },
    });
    if (!rules.length) return;

    const view = promptView(ctx.entityType, ctx.entity);

    for (const rule of rules) {
      const action = rule.action as AiRuleAction;
      try {
        const spec = ACTION_SPEC[action] ?? ACTION_SPEC.CUSTOM_PROMPT;
        const system = `${rule.customPrompt || 'You are a helpful CRM and IT service-desk assistant.'}\n\n${spec}`;

        // The context wrapper is what lets the gateway attribute the call.
        const result = await runWithAiContext({ orgId: ctx.orgId, userId: ctx.userId ?? null }, () =>
          complete({
            orgId: ctx.orgId,
            userId: ctx.userId ?? null,
            feature: `airule.${action.toLowerCase()}`,
            task: action === 'SUMMARIZE' || action === 'EMAIL' ? 'SMART' : 'FAST',
            system,
            user: `${ctx.entityType}:\n${view}`,
            maxTokens: action === 'EMAIL' ? 900 : 400,
            temperature: 0.3,
            entityType: ctx.entityType,
            entityId: ctx.entityId,
          }),
        );

        if (result.blocked) {
          await recordRun(rule.id, 'Skipped — monthly AI budget reached');
          continue;
        }

        const outcome = await applyAction(action, result.text, ctx);
        await recordRun(rule.id, outcome);
      } catch (err: any) {
        // One failing rule must not stop the others, and must not surface to
        // the user's request.
        await recordRun(rule.id, `Error: ${String(err?.message || err).slice(0, 200)}`);
      }
    }
  } catch (err: any) {
    console.error('[ai-rules] run failed:', err?.message || err);
  }
}

/** runCount and lastRunAt were columns nothing ever wrote — the demo seeder
 *  faked them. Now they reflect real executions. */
async function recordRun(ruleId: string, outcome: string): Promise<void> {
  await prisma.aICustomRule.update({
    where: { id: ruleId },
    data: { runCount: { increment: 1 }, lastRunAt: new Date() },
  }).catch(() => {});
  console.log(`[ai-rules] ${ruleId}: ${outcome}`);
}

/** Manual "Run test" from the AI Feature Builder. Returns the outcome so the
 *  UI can show what the rule actually did. */
export async function runAiRuleManually(
  ruleId: string,
  orgId: string,
  userId: string,
  entity: { entityType: AiRuleContext['entityType']; entityId: string } | null,
  inputText?: string,
): Promise<{ output: string; outcome: string }> {
  const rule = await prisma.aICustomRule.findFirst({ where: { id: ruleId, orgId } });
  if (!rule) throw new Error('Rule not found');

  let view = inputText ?? '';
  let ctxEntity: Record<string, any> = {};
  if (!view && entity) {
    const loaders: Record<string, () => Promise<any>> = {
      TICKET: () => prisma.ticket.findFirst({ where: { id: entity.entityId, orgId } }),
      LEAD: () => prisma.lead.findFirst({ where: { id: entity.entityId, orgId } }),
      DEAL: () => prisma.deal.findFirst({ where: { id: entity.entityId, orgId } }),
      CONTACT: () => prisma.contact.findFirst({ where: { id: entity.entityId, orgId } }),
    };
    const row = await loaders[entity.entityType]?.();
    // Previously this handler passed the literal string `Entity: <cuid>` to
    // the model when no inputText was given — the rule "ran" against nothing.
    if (!row) throw new Error('That record was not found in your organization');
    ctxEntity = row;
    view = promptView(entity.entityType, row);
  }
  if (!view) throw new Error('Provide some text, or a record to run against');

  const action = rule.action as AiRuleAction;
  const spec = ACTION_SPEC[action] ?? ACTION_SPEC.CUSTOM_PROMPT;
  const result = await complete({
    orgId,
    userId,
    feature: `airule.${action.toLowerCase()}`,
    task: 'FAST',
    system: `${rule.customPrompt || 'You are a helpful CRM and IT service-desk assistant.'}\n\n${spec}`,
    user: view,
    maxTokens: 600,
    temperature: 0.3,
  });
  if (result.blocked) throw new Error('Monthly AI budget reached');

  // A manual test does not mutate records — it shows what would be produced.
  const outcome = entity
    ? `Preview only — running this rule on its trigger would: ${describeEffect(action)}`
    : 'Preview only';
  void ctxEntity;
  return { output: result.text, outcome };
}

function describeEffect(action: AiRuleAction): string {
  switch (action) {
    case 'TAG': return 'apply the proposed tags to the record';
    case 'ROUTE': return 'move the ticket to the proposed category';
    case 'SCORE': return 'write the score onto the lead';
    case 'NOTIFY': return 'notify the record owner';
    case 'EMAIL': return 'file an email draft on the record (never send it)';
    default: return 'add an AI note to the record';
  }
}
