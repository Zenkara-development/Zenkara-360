import { prisma } from './prisma';
import crypto from 'crypto';
import { sendWhatsApp } from './whatsapp';
import { resolveRecipientPhone } from './notification-recipient';
import { scoreLead, pickAssignment } from './ai';
import { sendPushToUser } from './webPush';
import { sendMail, emailTemplates } from './mailer';

// ─── Outbound webhook delivery (signed + retried) ─────────────────────────────
// Previously this action fired a single, unsigned fetch() with no retry —
// a receiver had no way to verify the payload actually came from us, and a
// transient network blip meant the automation silently never fired at all.

/**
 * Blocks webhook targets that point back inside the network.
 *
 * The URL comes from a rule any manager can edit, and this runs server-side —
 * so without a guard a rule could aim at cloud metadata (169.254.169.254),
 * localhost, or a private-range service, and the log detail would report the
 * outcome back to whoever configured it. That is a server-side request
 * forgery primitive with a readable response channel.
 *
 * Hostname-based, so it does not catch a public DNS name resolving to a
 * private address (a full fix needs resolve-then-pin, which fetch does not
 * expose). It removes the trivial cases; treat outbound webhooks as
 * privileged either way.
 */
function isBlockedWebhookHost(rawUrl: string): string | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return 'not a valid URL'; }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') return `unsupported protocol ${u.protocol}`;
  if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') return 'must use https';

  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return 'points at localhost';
  if (h.endsWith('.internal') || h.endsWith('.local')) return 'points at an internal hostname';

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return 'points at loopback';
    if (a === 10) return 'points at a private network';
    if (a === 172 && b >= 16 && b <= 31) return 'points at a private network';
    if (a === 192 && b === 168) return 'points at a private network';
    if (a === 169 && b === 254) return 'points at link-local / cloud metadata';
    if (a === 100 && b >= 64 && b <= 127) return 'points at carrier-grade NAT space';
    if (a === 0) return 'points at an unspecified address';
  }
  // IPv6 loopback / unique-local / link-local
  if (h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) {
    return 'points at a private IPv6 address';
  }
  return null;
}

/**
 * A signing secret unique to one org, derived from the platform secret.
 *
 * Deliberately derived rather than stored: it gives every tenant a distinct
 * key — so org A can no longer verify or forge org B's payloads — without a
 * schema change or a secret-rotation UI. It is stable for a given
 * (WORKFLOW_WEBHOOK_SECRET, orgId) pair, so a receiver can be told its value
 * once and keep verifying. Rotating the platform secret rotates every org's.
 */
function orgWebhookSecret(orgId: string): string | undefined {
  const root = process.env.WORKFLOW_WEBHOOK_SECRET;
  if (!root) return undefined;
  return crypto.createHmac('sha256', root).update(`workflow-webhook:${orgId}`).digest('hex');
}

/** POSTs a JSON payload with an HMAC signature header, retrying transient failures. */
async function postWebhookWithRetry(
  url: string,
  payload: unknown,
  maxAttempts = 3,
  signingSecret?: string,
): Promise<string> {
  const blocked = isBlockedWebhookHost(url);
  if (blocked) return `Webhook skipped — target ${blocked}`;

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  /* Prefer the org's own signing secret. A single global
     WORKFLOW_WEBHOOK_SECRET meant every tenant's webhooks were signed with
     the same key — so any org could both verify and forge another org's
     payloads, which makes the signature worthless as proof of origin. */
  const secret = signingSecret || process.env.WORKFLOW_WEBHOOK_SECRET;
  if (secret) {
    headers['X-Webhook-Signature'] = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  /* Lets a receiver discard a duplicate. The retry loop re-POSTs on a 5xx or
     a timeout, and the payload carried only a `timestamp` that changed every
     attempt — so a receiver that committed the work but failed to respond got
     it again with no way to tell. */
  const deliveryId = crypto.randomUUID();
  headers['X-Webhook-Delivery'] = deliveryId;

  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'X-Webhook-Attempt': String(attempt) },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        return attempt === 1 ? `Webhook sent to ${url}` : `Webhook sent to ${url} (succeeded on attempt ${attempt})`;
      }
      lastError = `HTTP ${res.status}`;
    } catch (e: any) {
      lastError = e.message;
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 500 * attempt)); // 500ms, then 1000ms
    }
  }
  return `Webhook to ${url} failed after ${maxAttempts} attempts: ${lastError}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowTrigger =
  | 'TICKET_CREATED'
  | 'TICKET_UPDATED'
  | 'TICKET_STATUS_CHANGED'
  | 'LEAD_CREATED'
  | 'LEAD_STATUS_CHANGED'
  | 'LEAD_ACTIVITY_COMPLETED'
  | 'DEAL_STAGE_CHANGED'
  | 'DEAL_WON'
  | 'DEAL_LOST'
  | 'SLA_BREACH'
  | 'DATE_FIELD_REACHED' // date-driven follow-ups — see utils/dateAutomation.ts
  /* Coverage for the newer modules — automation used to stop at
     tickets/leads/deals while the product kept growing past them. */
  | 'CUSTOM_RECORD_CREATED'   // a record lands in any custom module (condition on moduleSlug to scope)
  | 'CUSTOM_RECORD_STAGE_CHANGED' // a record moves on a module's pipeline board (entity carries stage + previousStage)
  | 'INVOICE_STATUS_CHANGED'  // SENT → PAID / OVERDUE / VOID etc.
  | 'QUOTE_STATUS_CHANGED'    // includes customer acceptance via the public link
  | 'CSAT_RECEIVED'           // a feedback rating arrived (condition on `rating` to catch the bad ones)
  | 'APPROVAL_DECIDED'        // an approval request was approved/rejected
  | 'LEAVE_REQUESTED';        // an employee filed a leave request

// Per-stage automation ("when a deal enters Negotiation, notify the
// manager") doesn't need its own trigger type — it's just DEAL_STAGE_CHANGED
// plus a condition on the `stage` field, since ctx.entity is always the
// deal *after* the move. See pipelines UI's "add automation" shortcut,
// which prefills exactly that trigger+condition pair.

interface Condition {
  field: string;    // e.g. 'priority', 'status', 'source', 'value'
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'in';
  value: string | number | string[];
}

interface Action {
  type:
    | 'ASSIGN_TO'           // assign ticket/lead/deal to a user
    | 'SET_PRIORITY'        // change ticket priority
    | 'SET_STATUS'          // change ticket/lead status
    | 'SEND_EMAIL'          // send email notification
    | 'SEND_WHATSAPP'       // send WhatsApp notification (TICKET/DEAL only)
    | 'ADD_NOTE'            // add internal note
    | 'SEND_WEBHOOK'        // POST to external URL
    | 'CREATE_TICKET'       // auto-create a follow-up ticket
    | 'SCORE_LEAD'          // trigger AI lead scoring
    | 'AI_AUTO_ASSIGN'      // AI picks department + owner for a ticket/lead
    | 'CREATE_NOTIFICATION' // in-app notification (bell icon), independent of email/WhatsApp
    | 'SEND_CSAT_SURVEY';   // feedback request — TICKET only, emails the requester the 1-5 star rating link
  params: Record<string, string | number>;
}

export interface WorkflowContext {
  trigger: WorkflowTrigger;
  orgId: string;
  // TICKET/LEAD/DEAL are the classic three; CONTACT and CUSTOM_MODULE_RECORD
  // arrive via DATE_FIELD_REACHED and CUSTOM_RECORD_CREATED; the rest carry
  // the newer modules' triggers. Entity-mutating actions (ASSIGN_TO,
  // SET_STATUS, …) stay guarded per type below — generic actions
  // (SEND_EMAIL, SEND_WEBHOOK, CREATE_NOTIFICATION, CREATE_TICKET) work for
  // every type since they only read ctx.entity fields.
  entityType: 'TICKET' | 'LEAD' | 'DEAL' | 'CONTACT' | 'CUSTOM_MODULE_RECORD'
    | 'INVOICE' | 'QUOTE' | 'APPROVAL' | 'LEAVE';
  entityId: string;
  entity: Record<string, any>;
  previousEntity?: Record<string, any>; // for update/change triggers
  /**
   * Run ONLY this rule.
   *
   * Event triggers leave this unset: a ticket being created should be offered
   * to every TICKET_CREATED rule, and each decides for itself via its own
   * conditions. Date automation is the opposite — dateAutomation.ts has
   * already worked out which single rule matches which record, so without
   * this every DATE_FIELD_REACHED rule in the org fired against a record only
   * one of them matched. A birthday rule matching a contact also sent them
   * the renewal-reminder rule's email.
   *
   * It compounded: runWorkflows logs a row per rule it touches, and
   * alreadyProcessedToday() treats any row within 330 days as "done" for a
   * yearly rule — so one cross-fire suppressed every other date rule on that
   * record for about eleven months.
   */
  ruleId?: string;
}

// ─── Condition evaluator ─────────────────────────────────────────────────────

function evaluateCondition(condition: Condition, entity: Record<string, any>): boolean {
  const fieldValue = entity[condition.field];
  const cv = condition.value;

  switch (condition.operator) {
    case 'eq':   return String(fieldValue) === String(cv);
    case 'neq':  return String(fieldValue) !== String(cv);
    case 'gt':   return Number(fieldValue) > Number(cv);
    case 'lt':   return Number(fieldValue) < Number(cv);
    case 'contains':
      return String(fieldValue ?? '').toLowerCase().includes(String(cv).toLowerCase());
    case 'in':
      return Array.isArray(cv) ? cv.includes(String(fieldValue)) : false;
    default:     return false;
  }
}

function evaluateConditions(conditions: Condition[], entity: Record<string, any>): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, entity));
}

// ─── Action executor ─────────────────────────────────────────────────────────

async function executeAction(action: Action, ctx: WorkflowContext): Promise<string> {
  const { entityType, entityId, orgId, entity } = ctx;

  switch (action.type) {
    case 'ASSIGN_TO': {
      const userId = String(action.params.userId ?? '');
      if (!userId) return 'ASSIGN_TO skipped — no user configured';

      /* The rule's params are stored as free-form JSON and the API validates
         them as `z.record(...)`, i.e. not at all. Without this check a rule
         carrying a foreign user id (hand-crafted, imported, or seeded)
         assigns this org's records to somebody in another org. */
      const assignee = await prisma.user.findFirst({ where: { id: userId, orgId }, select: { id: true } });
      if (!assignee) return `ASSIGN_TO skipped — user ${userId} is not in this organization`;

      if (entityType === 'TICKET') {
        await prisma.ticket.updateMany({ where: { id: entityId, orgId }, data: { assignedTo: userId } });
      } else if (entityType === 'LEAD') {
        await prisma.lead.updateMany({ where: { id: entityId, orgId }, data: { assignedTo: userId } });
      } else if (entityType === 'DEAL') {
        await prisma.deal.updateMany({ where: { id: entityId, orgId }, data: { assignedTo: userId } });
      } else {
        // Contacts and custom-module records have no assignee column. This
        // used to fall out of the if/else and still report "Assigned to user
        // X" — a SUCCESS log for something that never happened.
        return `ASSIGN_TO skipped — ${entityType} has no assignee field`;
      }
      return `Assigned to user ${userId}`;
    }

    case 'SET_PRIORITY': {
      if (entityType !== 'TICKET') return 'SET_PRIORITY only applies to tickets';
      const priority = String(action.params.priority);
      await prisma.ticket.updateMany({ where: { id: entityId, orgId }, data: { priority: priority as any } });
      return `Priority set to ${priority}`;
    }

    case 'SET_STATUS': {
      const status = String(action.params.status ?? '');
      if (!status) return 'SET_STATUS skipped — no status configured';
      if (entityType === 'TICKET') {
        await prisma.ticket.updateMany({ where: { id: entityId, orgId }, data: { status: status as any } });
      } else if (entityType === 'LEAD') {
        await prisma.lead.updateMany({ where: { id: entityId, orgId }, data: { status: status as any } });
      } else {
        /* Deals were the notable miss: three of the eleven triggers are deal
           triggers, so "when a deal is won, set status" is an obvious rule to
           build — and it wrote nothing while logging "Status set to WON".
           A deal's pipeline position is `stage`, and its won/lost state is
           `status`, so SET_STATUS cannot guess which was meant; say so rather
           than pick one. */
        return entityType === 'DEAL'
          ? 'SET_STATUS skipped — set a deal\'s pipeline position with a stage action, not SET_STATUS'
          : `SET_STATUS skipped — ${entityType} has no status field`;
      }
      return `Status set to ${status}`;
    }

    case 'SEND_EMAIL': {
      const { to, subject, body } = action.params as Record<string, string>;
      // Resolve template variables: {{title}}, {{status}}, {{priority}}, {{id}}
      const resolve = (s: string) =>
        s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(entity[k] ?? k));

      const emailAccount = await prisma.emailAccount.findUnique({ where: { orgId }, select: { id: true } });
      if (!emailAccount) return 'Email skipped — no email account connected';

      // sendMail's org-branding + org-SMTP lookup (display name from
      // orgBranding/organization, transport from EmailAccount) lives in
      // mailer.ts now — passing orgId routes it there instead of duplicating
      // that lookup here. plain-text body -> <br>-joined html, since
      // sendMail only takes html.
      await sendMail({
        orgId,
        to: resolve(to),
        subject: resolve(subject || 'CRM Notification'),
        html: resolve(body || '').replace(/\n/g, '<br>'),
      });
      return `Email sent to ${resolve(to)}`;
    }

    case 'SEND_WHATSAPP': {
      if (entityType !== 'TICKET' && entityType !== 'DEAL' && entityType !== 'CONTACT' && entityType !== 'CUSTOM_MODULE_RECORD') {
        return `SEND_WHATSAPP skipped — not supported for ${entityType}`;
      }
      const { recipientType, message, referenceFieldId } = action.params as Record<string, string>;
      const resolve = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(entity[k] ?? k));
      // customNumber may itself be a template like "{{phone}}" — the only way
      // a CUSTOM_MODULE_RECORD (which has no dedicated recipient-lookup case
      // below) can point at a phone number stored in one of its own fields.
      const customNumber = action.params.customNumber ? resolve(String(action.params.customNumber)) : undefined;
      try {
        const phone = await resolveRecipientPhone({
          orgId, entityType, entityId,
          recipientType: (recipientType || 'ORG_DEFAULT') as any,
          customNumber,
          referenceFieldId: referenceFieldId || undefined,
        });
        await sendWhatsApp(orgId, phone, resolve(message || ''));
        return `WhatsApp sent to ${phone}`;
      } catch (err: any) {
        return `WhatsApp skipped — ${err?.message || err}`;
      }
    }

    case 'ADD_NOTE': {
      const entityTypeMap: Record<string, 'DEAL' | 'TICKET' | 'CONTACT'> = {
        TICKET: 'TICKET',
        DEAL: 'DEAL',
        CONTACT: 'CONTACT',
      };
      // Was previously `|| 'TICKET'`, which silently mis-filed a note under
      // Comment.entityType = 'TICKET' for any unmapped entity — harmless
      // while only TICKET/LEAD/DEAL existed (LEAD already fell through to
      // this same bug, unnoticed), but CUSTOM_MODULE_RECORD would now write
      // a fake ticket comment with someone else's record id. Skip cleanly instead.
      const mappedType = entityTypeMap[entityType];
      if (!mappedType) return `ADD_NOTE skipped — comments aren't supported on ${entityType}`;

      const noteBody = String(action.params.body || 'Automated workflow note');
      /* A comment needs an author. When the org has no SUPER_ADMIN this used
         to skip the create and still return 'Note added' — a SUCCESS row for
         a note nobody can find. Fall back to any admin, then report honestly. */
      const systemUser = await prisma.user.findFirst({
        // There is no generic ADMIN role — the org-scoped admin tiers are
        // SUPER_ADMIN, then the two manager roles. PLATFORM_ADMIN is excluded
        // deliberately: it is cross-org and has no orgId.
        where: { orgId, role: { in: ['SUPER_ADMIN', 'CRM_MANAGER', 'IT_MANAGER'] }, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!systemUser) return 'ADD_NOTE skipped — no admin user in this organization to attribute the note to';

      await prisma.comment.create({
        data: {
          authorId: systemUser.id,
          entityType: mappedType,
          entityId,
          body: `[Automation] ${noteBody}`,
        },
      });
      return 'Note added';
    }

    case 'SEND_WEBHOOK': {
      const url = String(action.params.url);
      if (!url) return 'Webhook skipped — no URL configured';
      const payload = {
        trigger: ctx.trigger,
        entityType,
        entityId,
        entity,
        timestamp: new Date().toISOString(),
      };
      return postWebhookWithRetry(url, payload, 3, orgWebhookSecret(orgId));
    }

    case 'CREATE_TICKET': {
      const requester = await prisma.user.findFirst({ where: { orgId, role: 'SUPER_ADMIN' } });
      if (!requester) return 'CREATE_TICKET skipped — no admin user to file it as';
      const resolve = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(entity[k] ?? k));
      const title = resolve(String(action.params.title || `Follow-up: ${entity.title || entity.name || entityId}`));
      const body = resolve(String(action.params.body || `Auto-created by workflow automation from ${entityType} ${entityId}.`));
      const priority = (String(action.params.priority || 'MEDIUM')).toUpperCase();
      const ticket = await prisma.ticket.create({
        data: { orgId, title, body, priority: priority as any, requesterId: requester.id },
      });
      return `Created ticket "${ticket.title}" (#${ticket.id.slice(-6)})`;
    }

    case 'SCORE_LEAD': {
      if (entityType !== 'LEAD') return 'SCORE_LEAD skipped — only applies to leads';
      const lead = await prisma.lead.findUnique({ where: { id: entityId }, include: { contact: true } });
      if (!lead) return 'SCORE_LEAD skipped — lead not found';
      const result = await scoreLead(lead as any);
      await prisma.lead.update({ where: { id: entityId }, data: { aiScore: result.score, aiScoreReason: result.reason } });
      return `Lead scored ${result.score}/100 — ${result.reason}`;
    }

    case 'AI_AUTO_ASSIGN': {
      /* The AI dispatcher: reads the fresh ticket/lead, the org's
         departments, and the eligible people with their live workloads, and
         fills in department + owner. Fill-only by default — a record that
         already has an assignee or department keeps it, so a human's choice
         is never overwritten (params.overwrite = 'always' opts out). Names
         come back from the model and are resolved to ids HERE, against this
         org only — an invented name simply doesn't match and that field is
         left unset. */
      if (entityType !== 'TICKET' && entityType !== 'LEAD') {
        return 'AI_AUTO_ASSIGN skipped — only applies to tickets and leads';
      }
      const overwrite = String(action.params.overwrite ?? '') === 'always';

      const fresh = entityType === 'TICKET'
        ? await prisma.ticket.findFirst({ where: { id: entityId, orgId } })
        : await prisma.lead.findFirst({ where: { id: entityId, orgId }, include: { contact: { select: { name: true } } } });
      if (!fresh) return 'AI_AUTO_ASSIGN skipped — record not found';
      const needsAssignee = overwrite || !(fresh as any).assignedTo;
      const needsDepartment = overwrite || !(fresh as any).departmentId;
      if (!needsAssignee && !needsDepartment) return 'AI_AUTO_ASSIGN skipped — already assigned';

      const departments = await prisma.department.findMany({
        where: { orgId, isActive: true }, select: { id: true, name: true },
      });
      const roles = entityType === 'TICKET' ? ['IT_MANAGER', 'IT_AGENT'] : ['CRM_MANAGER', 'SALES_REP'];
      const people = await prisma.user.findMany({
        where: { orgId, isActive: true, role: { in: roles as any } },
        select: { id: true, name: true, department: true },
      });
      if (!people.length) return 'AI_AUTO_ASSIGN skipped — no eligible teammates';

      // Live workload per candidate — open items they already own.
      const counts = entityType === 'TICKET'
        ? await prisma.ticket.groupBy({ by: ['assignedTo'], where: { orgId, assignedTo: { in: people.map(p => p.id) }, status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING'] as any } }, _count: { _all: true } })
        : await prisma.lead.groupBy({ by: ['assignedTo'], where: { orgId, assignedTo: { in: people.map(p => p.id) }, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] as any } }, _count: { _all: true } });
      const countBy: Record<string, number> = {};
      for (const c of counts as any[]) if (c.assignedTo) countBy[c.assignedTo] = c._count._all;

      const title = entityType === 'TICKET'
        ? String((fresh as any).title ?? '')
        : `Lead${(fresh as any).contact?.name ? ` for ${(fresh as any).contact.name}` : ''}${(fresh as any).source ? ` from ${(fresh as any).source}` : ''}`;
      const body = entityType === 'TICKET' ? String((fresh as any).body ?? '') : String((fresh as any).notes ?? '');

      const pick = await pickAssignment(
        entityType,
        { title, body },
        departments.map(d => ({ name: d.name })),
        people.map(p => ({ name: p.name, department: p.department, openCount: countBy[p.id] ?? 0 })),
      );

      const dep = pick.departmentName
        ? departments.find(d => d.name.toLowerCase() === pick.departmentName!.toLowerCase())
        : undefined;
      const person = pick.assigneeName
        ? people.find(p => p.name.toLowerCase() === pick.assigneeName!.toLowerCase())
        : undefined;

      const data: Record<string, unknown> = {};
      if (needsDepartment && dep) data.departmentId = dep.id;
      if (needsAssignee && person) data.assignedTo = person.id;
      if (!Object.keys(data).length) return `AI_AUTO_ASSIGN made no change — ${pick.reason || 'no confident match'}`;

      if (entityType === 'TICKET') {
        await prisma.ticket.updateMany({ where: { id: entityId, orgId }, data });
      } else {
        await prisma.lead.updateMany({ where: { id: entityId, orgId }, data });
      }
      const parts = [
        data.assignedTo ? `assigned to ${person!.name}` : null,
        data.departmentId ? `department ${dep!.name}` : null,
      ].filter(Boolean).join(', ');
      return `AI auto-assign: ${parts}${pick.reason ? ` — ${pick.reason}` : ''}`;
    }

    case 'SEND_CSAT_SURVEY': {
      // Previously hardcoded as a setTimeout in tickets.controller.ts's
      // changeStatus(), firing unconditionally 5s after every RESOLVED —
      // now a normal workflow action so it can be retimed, conditioned
      // (e.g. only for certain categories), or turned off per org without
      // a code change. entity.requester/entity.contact come from the ticket
      // `include` on every trigger that fires on a Ticket, so no extra query
      // is needed for those two cases.
      if (entityType !== 'TICKET') return 'SEND_CSAT_SURVEY skipped — only applies to tickets';

      // recipientType: 'REQUESTER' (default — whoever filed the ticket),
      // 'CONTACT' (the Contact it was filed on behalf of, if any — see
      // Ticket.contactId), or 'REFERENCE_FIELD' (an org-defined REFERENCE
      // custom field on tickets, resolved to a Contact).
      const recipientType = String(action.params.recipientType || 'REQUESTER');
      let toEmail: string | undefined;
      let toName = 'there';
      if (recipientType === 'CONTACT') {
        toEmail = entity.contact?.email;
        toName = entity.contact?.name || toName;
        if (!toEmail) return 'SEND_CSAT_SURVEY skipped — ticket has no linked contact with an email on file';
      } else if (recipientType === 'REFERENCE_FIELD') {
        const referenceFieldId = String(action.params.referenceFieldId || '');
        if (!referenceFieldId) return 'SEND_CSAT_SURVEY skipped — no reference field selected';
        const fieldValue = await prisma.customFieldValue.findUnique({
          where: { customFieldId_entityId: { customFieldId: referenceFieldId, entityId } },
        });
        const contact = fieldValue?.value
          ? await prisma.contact.findFirst({ where: { id: fieldValue.value, orgId }, select: { name: true, email: true } })
          : null;
        if (!contact?.email) return 'SEND_CSAT_SURVEY skipped — the referenced contact has no email on file';
        toEmail = contact.email;
        toName = contact.name || toName;
      } else {
        toEmail = entity.requester?.email;
        toName = entity.requester?.name || toName;
        if (!toEmail) return 'SEND_CSAT_SURVEY skipped — ticket has no requester email on file';
      }

      await sendMail({ ...emailTemplates.csatSurvey({ id: entityId, title: String(entity.title || '') }, toName, toEmail), orgId });
      return `CSAT survey sent to ${toEmail}`;
    }

    case 'CREATE_NOTIFICATION': {
      const { title, body, recipientType, userId: explicitUserId } = action.params as Record<string, string>;
      const resolve = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(entity[k] ?? k));
      let targetUserId: string | undefined = explicitUserId;
      if (!targetUserId && recipientType === 'ASSIGNEE') {
        // Contact has no assignedTo — its equivalent is ownerId (the CRM
        // rep who owns the relationship). CUSTOM_MODULE_RECORD has neither,
        // so ASSIGNEE simply resolves to nothing there — use an explicit
        // userId in the rule's params instead.
        targetUserId = entity.assignedTo || entity.assignee?.id || entity.ownerId;
      }
      if (!targetUserId) {
        /* Nothing resolved — common for the newer entity types (invoices,
           custom records, approvals, leave) that have no assignee concept.
           Falling back to the org admins beats silently dropping the
           notification: an automation someone bothered to build should land
           somewhere visible, and admins can always re-point the rule at an
           explicit user. */
        const admins = await prisma.user.findMany({
          where: { orgId, role: 'SUPER_ADMIN', isActive: true }, select: { id: true },
        });
        if (!admins.length) return 'Notification skipped — no recipient resolved';
        const resolvedTitle = String(action.params.title || 'Workflow automation').replace(/\{\{(\w+)\}\}/g, (_, k) => String(entity[k] ?? k));
        const resolvedBody = String(action.params.body || '').replace(/\{\{(\w+)\}\}/g, (_, k) => String(entity[k] ?? k));
        await Promise.all(admins.map(a => prisma.notification.create({
          data: { orgId, userId: a.id, type: 'STATUS_CHANGE', title: resolvedTitle, body: resolvedBody, entityType, entityId },
        })));
        return `Notification sent to ${admins.length} org admin(s) (no explicit recipient configured)`;
      }

      /* Notification.userId is an unconstrained FK and the bell query filters
         by userId alone, so an out-of-org id here delivered this org's record
         title and body into someone else's notification list AND fired a real
         browser push at them. params are unvalidated by the API, so this is
         the only place it can be caught. */
      const recipient = await prisma.user.findFirst({
        where: { id: targetUserId, orgId }, select: { id: true },
      });
      if (!recipient) return `Notification skipped — user ${targetUserId} is not in this organization`;
      const notifTitle = resolve(String(title || 'Workflow automation'));
      const notifBody = resolve(String(body || ''));
      await prisma.notification.create({
        data: {
          orgId,
          userId: targetUserId,
          type: 'STATUS_CHANGE',
          title: notifTitle,
          body: notifBody,
          entityId,
          entityType,
        },
      });
      // Real browser push, on top of the in-app bell — see utils/webPush.ts.
      sendPushToUser(targetUserId, { title: notifTitle, body: notifBody }).catch(() => {});
      return `Notification created for user ${targetUserId}`;
    }

    default:
      return `Unknown action type: ${action.type}`;
  }
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runWorkflows(ctx: WorkflowContext): Promise<void> {
  try {
    const rules = await prisma.workflowRule.findMany({
      where: {
        orgId: ctx.orgId,
        trigger: ctx.trigger,
        isActive: true,
        // Still org- and trigger-scoped even when targeted, so a caller
        // cannot reach another org's rule by passing its id.
        ...(ctx.ruleId ? { id: ctx.ruleId } : {}),
      },
    });

    for (const rule of rules) {
      const conditions = (rule.conditions as unknown as Condition[]) || [];
      const actions = (rule.actions as unknown as Action[]) || [];

      const matches = evaluateConditions(conditions, ctx.entity);

      if (!matches) {
        await prisma.workflowLog.create({
          data: { ruleId: rule.id, entityType: ctx.entityType, entityId: ctx.entityId, result: 'SKIPPED', detail: 'Conditions not met' },
        });
        continue;
      }

      const results: string[] = [];
      let hasError = false;

      for (const action of actions) {
        try {
          const detail = await executeAction(action, ctx);
          results.push(`${action.type}: ${detail}`);
        } catch (err: any) {
          results.push(`${action.type}: ERROR — ${err.message}`);
          hasError = true;
        }
      }

      await prisma.workflowLog.create({
        data: {
          ruleId: rule.id,
          entityType: ctx.entityType,
          entityId: ctx.entityId,
          result: hasError ? 'ERROR' : 'SUCCESS',
          detail: results.join(' | '),
        },
      });

      // Increment run count
      await prisma.workflowRule.update({
        where: { id: rule.id },
        data: { runCount: { increment: 1 } },
      });
    }
  } catch (err: any) {
    console.error('[workflow-engine] Error:', err.message);
  }
}
