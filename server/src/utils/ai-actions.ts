/**
 * AI Action Registry — the whitelist of everything an AI-driven command can
 * actually DO to the database.
 *
 * This is the safety boundary for the "AI Command" feature: the LLM never
 * gets to run its own query or invent behavior. It can only ever pick a
 * `name` from this list, and every handler here re-checks org scope and
 * role permission itself — the model's opinion of what's allowed is never
 * trusted, only its choice of *which* registered action to propose.
 *
 * Each action's `handler` deliberately mirrors the logic in the equivalent
 * hand-written controller (deals.controller.ts, tickets.controller.ts, etc.)
 * rather than importing it directly, since those controllers are shaped
 * around (req, res, next) and this registry needs a plain
 * (params, ctx) => result function that both the "execute" endpoint and
 * (later, if ever wanted) a background runner can call the same way.
 */
import { z, ZodSchema } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';
import { runWorkflows } from './workflow-engine';
import { scoreLead as aiScoreLead } from './ai';
import { sendWhatsApp } from './whatsapp';
import { resolveRecipientPhone } from './notification-recipient';
import { MANAGERS, CRM_STAFF, IT_STAFF, IT_MANAGERS, ALL_STAFF, ALL_USERS, CRM_MANAGERS } from '../middleware/authenticate';
import { FIELD_TYPES, slugify, validateRecordData, recordTitle } from '../modules/custom-modules/customModules.service';
import { pushCalendarEvent } from './googleCalendar';
import { notifyOrgAdmins } from '../modules/notifications/notifications.controller';
import { sendCampaignNow } from '../modules/campaigns/campaigns.controller';

export interface AiActionContext {
  orgId: string;
  userId: string;
}

export interface AiActionResult {
  summary: string;
  data?: unknown;
}

export interface AiActionDefinition<TParams = any> {
  name: string;
  label: string;
  /** Shown to the LLM as part of its menu of choices — keep this precise. */
  description: string;
  /** A single realistic natural-language command a user could actually type
   * to trigger this action — shown in the AI Command Bar's "what can I say"
   * help panel (GET /ai/actions), not sent to the LLM. Deliberately separate
   * from the "e.g. ..." snippet inside `description` above: that one's
   * written for the model (terse, embedded in a sentence), this one's
   * written for a person skimming a list. */
  example: string;
  /** Shown to the LLM so it knows what shape to fill `params` with. */
  paramsHint: string;
  /** Role names allowed to invoke this action — checked server-side, always. */
  allowedRoles: readonly string[];
  /** Destructive/irreversible/outbound actions should always require confirmation. */
  requiresConfirmation: boolean;
  schema: ZodSchema<TParams>;
  handler: (params: TParams, ctx: AiActionContext) => Promise<AiActionResult>;
}

async function assertOwnedByOrg(entityType: 'TICKET' | 'DEAL' | 'CONTACT', entityId: string, orgId: string) {
  const found = entityType === 'TICKET'
    ? await prisma.ticket.findFirst({ where: { id: entityId, orgId }, select: { id: true, title: true } })
    : entityType === 'DEAL'
      ? await prisma.deal.findFirst({ where: { id: entityId, orgId }, select: { id: true, title: true } })
      : await prisma.contact.findFirst({ where: { id: entityId, orgId }, select: { id: true, name: true } });
  if (!found) throw new AppError(404, `${entityType.toLowerCase()} not found`);
  return found;
}

export const AI_ACTIONS: AiActionDefinition[] = [
  // ── Create a ticket ────────────────────────────────────────────────────
  // The chat copilot's workhorse: "the printer in the boardroom is jammed
  // again, file a ticket" — or filing a whole WhatsApp/email conversation
  // as a ticket in one step. Fires TICKET_CREATED workflows exactly like
  // the hand-written controller, so auto-assignment rules still apply.
  {
    name: 'CREATE_TICKET',
    label: 'Create a ticket',
    description: 'Creates a new support/help-desk ticket (e.g. "create a high priority ticket: VPN down for the sales team"). Use categoryName only if the user names a matching category.',
    example: 'Create a high priority ticket: projector in the boardroom is flickering',
    paramsHint: '{ title: string, body: string, priority?: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", categoryName?: string }',
    allowedRoles: ALL_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      title: z.string().min(3).max(200),
      body: z.string().min(1).max(5000),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      categoryName: z.string().optional(),
    }),
    handler: async (params, ctx) => {
      const category = params.categoryName
        ? await prisma.category.findFirst({ where: { orgId: ctx.orgId, name: { equals: params.categoryName, mode: 'insensitive' } }, select: { id: true } })
        : null;
      const ticket = await prisma.ticket.create({
        data: {
          orgId: ctx.orgId, title: params.title, body: params.body,
          priority: (params.priority ?? 'MEDIUM') as any,
          categoryId: category?.id, requesterId: ctx.userId,
        },
        include: { category: { select: { name: true } } },
      });
      runWorkflows({ trigger: 'TICKET_CREATED', orgId: ctx.orgId, entityType: 'TICKET', entityId: ticket.id, entity: ticket as any }).catch(() => {});
      return { summary: `Created ${ticket.priority} ticket "${ticket.title}"${category ? ` in ${params.categoryName}` : ''}.`, data: ticket };
    },
  },

  // ── Create a lead ──────────────────────────────────────────────────────
  // Matches an existing contact by email, then name; creates one when the
  // person is new. Fires LEAD_CREATED, so the seeded "score new leads
  // automatically" rule kicks in without a second step.
  {
    name: 'CREATE_LEAD',
    label: 'Create a lead',
    description: 'Creates a sales lead for a person (e.g. "add a lead for Maria Gomez at Initech, met her at the expo, interested in the CRM"). Reuses the org contact if the email or exact name already exists.',
    example: 'Add a lead for Maria Gomez from Initech — met at the expo, wants a demo',
    paramsHint: '{ contactName: string, contactEmail?: string, company?: string, notes?: string, source?: string }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      contactName: z.string().min(2).max(120),
      contactEmail: z.string().email().optional(),
      company: z.string().max(120).optional(),
      notes: z.string().max(2000).optional(),
      source: z.string().max(60).optional(),
    }),
    handler: async (params, ctx) => {
      let contact = params.contactEmail
        ? await prisma.contact.findFirst({ where: { orgId: ctx.orgId, email: { equals: params.contactEmail, mode: 'insensitive' } } })
        : null;
      if (!contact) {
        contact = await prisma.contact.findFirst({ where: { orgId: ctx.orgId, name: { equals: params.contactName, mode: 'insensitive' } } });
      }
      let createdContact = false;
      if (!contact) {
        /* Contact has no company column — an org Account is the nearest
           concept; match one by name when given, else leave unlinked. */
        const account = params.company
          ? await prisma.account.findFirst({ where: { orgId: ctx.orgId, name: { contains: params.company, mode: 'insensitive' } }, select: { id: true } })
          : null;
        contact = await prisma.contact.create({ data: {
          orgId: ctx.orgId, ownerId: ctx.userId, name: params.contactName,
          email: params.contactEmail, accountId: account?.id, source: params.source ?? 'Chat',
        }});
        createdContact = true;
      }
      const lead = await prisma.lead.create({ data: {
        orgId: ctx.orgId, contactId: contact.id, source: params.source ?? 'Chat',
        notes: params.notes, assignedTo: ctx.userId,
      }});
      runWorkflows({ trigger: 'LEAD_CREATED', orgId: ctx.orgId, entityType: 'LEAD', entityId: lead.id, entity: lead as any }).catch(() => {});
      return { summary: `Created a lead for ${contact.name}${createdContact ? ' (new contact)' : ' (existing contact)'}${params.source ? ` from ${params.source}` : ''}.`, data: lead };
    },
  },

  // ── Move a deal to a different pipeline stage ──────────────────────────
  {
    name: 'MOVE_DEAL_STAGE',
    label: 'Move deal stage',
    description: 'Moves a deal to a different pipeline stage (e.g. "move the Acme deal to Proposal").',
    example: 'Move the Acme deal to Proposal',
    paramsHint: '{ dealId: string, stage: string }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: true,
    schema: z.object({ dealId: z.string().min(1), stage: z.string().min(1) }),
    handler: async (params, ctx) => {
      const existing = await prisma.deal.findFirst({ where: { id: params.dealId, orgId: ctx.orgId } });
      if (!existing) throw new AppError(404, 'Deal not found');
      const deal = await prisma.deal.update({ where: { id: params.dealId }, data: { stage: params.stage } });
      await prisma.dealHistory.create({
        data: { dealId: deal.id, fromStage: existing.stage, toStage: params.stage, changedBy: ctx.userId },
      });
      runWorkflows({
        trigger: 'DEAL_STAGE_CHANGED', orgId: ctx.orgId, entityType: 'DEAL',
        entityId: deal.id, entity: deal as any, previousEntity: existing as any,
      }).catch(() => {});
      return { summary: `Moved "${deal.title}" from ${existing.stage} to ${params.stage}.`, data: deal };
    },
  },

  // ── Change a ticket's status ────────────────────────────────────────────
  {
    name: 'UPDATE_TICKET_STATUS',
    label: 'Change ticket status',
    description: 'Changes a ticket\'s status (e.g. "mark the VPN ticket as resolved").',
    example: 'Mark the VPN ticket as resolved',
    paramsHint: '{ ticketId: string, status: "OPEN"|"IN_PROGRESS"|"PENDING"|"RESOLVED"|"CLOSED" }',
    allowedRoles: IT_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      ticketId: z.string().min(1),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED']),
    }),
    handler: async (params, ctx) => {
      const existing = await prisma.ticket.findFirst({ where: { id: params.ticketId, orgId: ctx.orgId } });
      if (!existing) throw new AppError(404, 'Ticket not found');
      const data: any = { status: params.status };
      if (params.status === 'RESOLVED') data.resolvedAt = new Date();
      if (params.status === 'CLOSED') data.closedAt = new Date();
      const ticket = await prisma.ticket.update({ where: { id: params.ticketId }, data });
      await prisma.ticketHistory.create({
        data: { ticketId: ticket.id, fromStatus: existing.status, toStatus: params.status, changedBy: ctx.userId },
      });
      runWorkflows({
        trigger: 'TICKET_STATUS_CHANGED', orgId: ctx.orgId, entityType: 'TICKET',
        entityId: ticket.id, entity: ticket as any, previousEntity: existing as any,
      }).catch(() => {});
      return { summary: `Set "${ticket.title}" to ${params.status}.`, data: ticket };
    },
  },

  // ── Schedule a WhatsApp reminder ────────────────────────────────────────
  {
    name: 'SCHEDULE_WHATSAPP_REMINDER',
    label: 'Schedule a WhatsApp reminder',
    description: 'Schedules a future WhatsApp reminder on a ticket or deal (e.g. "remind the assignee about the Acme deal tomorrow at 9am").',
    example: 'Remind the assignee about the Acme deal tomorrow at 9am',
    paramsHint: '{ entityType: "TICKET"|"DEAL", entityId: string, dueAt: ISO datetime string, message: string, recipientType?: "CONTACT"|"ASSIGNEE"|"CUSTOM_NUMBER"|"ORG_DEFAULT" (default ASSIGNEE), customNumber?: string, recurrence?: "NONE"|"DAILY"|"WEEKLY" (default NONE) }',
    allowedRoles: ALL_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      entityType: z.enum(['TICKET', 'DEAL']),
      entityId: z.string().min(1),
      dueAt: z.string().min(1),
      message: z.string().min(1).max(1000),
      recipientType: z.enum(['CONTACT', 'ASSIGNEE', 'CUSTOM_NUMBER', 'ORG_DEFAULT']).default('ASSIGNEE'),
      customNumber: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
      recurrence: z.enum(['NONE', 'DAILY', 'WEEKLY']).default('NONE'),
    }),
    handler: async (params, ctx) => {
      if (params.recipientType === 'CUSTOM_NUMBER' && !params.customNumber) {
        throw new AppError(400, 'A phone number is required when the recipient is "Custom number"');
      }
      if (params.recipientType === 'CONTACT' && params.entityType !== 'DEAL') {
        throw new AppError(400, 'Only deals have a linked contact — choose a different recipient for tickets');
      }
      const exists = params.entityType === 'TICKET'
        ? await prisma.ticket.findFirst({ where: { id: params.entityId, orgId: ctx.orgId }, select: { id: true, title: true } })
        : await prisma.deal.findFirst({ where: { id: params.entityId, orgId: ctx.orgId }, select: { id: true, title: true } });
      if (!exists) throw new AppError(404, `${params.entityType === 'TICKET' ? 'Ticket' : 'Deal'} not found`);

      const schedule = await prisma.schedule.create({
        data: {
          orgId: ctx.orgId,
          entityType: params.entityType,
          entityId: params.entityId,
          dueAt: new Date(params.dueAt),
          recurrence: params.recurrence,
          message: params.message,
          recipientType: params.recipientType,
          customNumber: params.customNumber || null,
          createdBy: ctx.userId,
        },
      });
      return { summary: `Scheduled a reminder on "${exists.title}" for ${new Date(params.dueAt).toLocaleString()}.`, data: schedule };
    },
  },

  // ── Send a WhatsApp message right now (not scheduled) ───────────────────
  {
    name: 'SEND_WHATSAPP_NOW',
    label: 'Send a WhatsApp message now',
    description: 'Sends a WhatsApp message immediately (not scheduled) to the resolved recipient of a ticket or deal.',
    example: 'Send a WhatsApp message to the Acme deal contact saying we’re on it',
    paramsHint: '{ entityType: "TICKET"|"DEAL", entityId: string, message: string, recipientType?: "CONTACT"|"ASSIGNEE"|"CUSTOM_NUMBER"|"ORG_DEFAULT" (default ASSIGNEE), customNumber?: string }',
    allowedRoles: ALL_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      entityType: z.enum(['TICKET', 'DEAL']),
      entityId: z.string().min(1),
      message: z.string().min(1).max(1000),
      recipientType: z.enum(['CONTACT', 'ASSIGNEE', 'CUSTOM_NUMBER', 'ORG_DEFAULT']).default('ASSIGNEE'),
      customNumber: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
    }),
    handler: async (params, ctx) => {
      if (params.recipientType === 'CUSTOM_NUMBER' && !params.customNumber) {
        throw new AppError(400, 'A phone number is required when the recipient is "Custom number"');
      }
      const phone = await resolveRecipientPhone({
        orgId: ctx.orgId,
        entityType: params.entityType,
        entityId: params.entityId,
        recipientType: params.recipientType,
        customNumber: params.customNumber,
      });
      await sendWhatsApp(ctx.orgId, phone, params.message);
      return { summary: `Sent a WhatsApp message to ${phone}.` };
    },
  },

  // ── Add a note/comment ───────────────────────────────────────────────────
  {
    name: 'ADD_NOTE',
    label: 'Add a note',
    description: 'Adds a note/comment to a ticket, deal, or contact (e.g. "add a note on the Acme deal saying we followed up").',
    example: 'Add a note on the Acme deal saying we followed up',
    paramsHint: '{ entityType: "TICKET"|"DEAL"|"CONTACT", entityId: string, body: string }',
    allowedRoles: ALL_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      entityType: z.enum(['TICKET', 'DEAL', 'CONTACT']),
      entityId: z.string().min(1),
      body: z.string().min(1).max(2000),
    }),
    handler: async (params, ctx) => {
      const entity = await assertOwnedByOrg(params.entityType, params.entityId, ctx.orgId);
      const comment = await prisma.comment.create({
        data: { entityType: params.entityType as any, entityId: params.entityId, body: params.body, authorId: ctx.userId },
      });
      const label = (entity as any).title || (entity as any).name || params.entityId;
      return { summary: `Added a note on "${label}".`, data: comment };
    },
  },

  // ── Score a lead ─────────────────────────────────────────────────────────
  {
    name: 'SCORE_LEAD',
    label: 'Score a lead',
    description: 'Runs AI lead scoring on a lead and saves the score (e.g. "score the John Doe lead").',
    example: 'Score the John Doe lead',
    paramsHint: '{ leadId: string }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: false,
    schema: z.object({ leadId: z.string().min(1) }),
    handler: async (params, ctx) => {
      const lead = await prisma.lead.findFirst({
        where: { id: params.leadId, orgId: ctx.orgId },
        include: { contact: { select: { name: true, email: true, jobTitle: true } } },
      });
      if (!lead) throw new AppError(404, 'Lead not found');
      const result = await aiScoreLead(lead as any);
      await prisma.lead.updateMany({
        where: { id: params.leadId, orgId: ctx.orgId },
        data: { aiScore: result.score, aiScoreReason: result.reason },
      });
      return { summary: `Scored "${lead.contact?.name || 'lead'}": ${result.score}/100 — ${result.reason}`, data: result };
    },
  },

  // ── Toggle a workflow rule on/off ────────────────────────────────────────
  {
    name: 'TOGGLE_WORKFLOW_RULE',
    label: 'Toggle a workflow rule',
    description: 'Turns an automation/workflow rule on or off by name (e.g. "disable the auto-assign rule").',
    example: 'Disable the auto-assign rule',
    paramsHint: '{ ruleId: string, isActive?: boolean (omit to just flip the current state) }',
    allowedRoles: MANAGERS,
    requiresConfirmation: true,
    schema: z.object({ ruleId: z.string().min(1), isActive: z.boolean().optional() }),
    handler: async (params, ctx) => {
      const rule = await prisma.workflowRule.findFirst({ where: { id: params.ruleId, orgId: ctx.orgId } });
      if (!rule) throw new AppError(404, 'Workflow rule not found');
      const nextActive = params.isActive ?? !rule.isActive;
      const updated = await prisma.workflowRule.update({ where: { id: params.ruleId }, data: { isActive: nextActive } });
      return { summary: `${nextActive ? 'Enabled' : 'Disabled'} the "${rule.name}" workflow rule.`, data: updated };
    },
  },

  // ── Assign a ticket to a user ────────────────────────────────────────────
  {
    name: 'ASSIGN_TICKET',
    label: 'Assign a ticket',
    description: 'Assigns a ticket to a specific agent and moves it to In Progress (e.g. "assign the VPN ticket to Priya"). Match the assignee by name from the assignableUsers context list.',
    example: 'Assign the VPN ticket to Priya',
    paramsHint: '{ ticketId: string, assigneeId: string }',
    allowedRoles: IT_STAFF,
    requiresConfirmation: true,
    schema: z.object({ ticketId: z.string().min(1), assigneeId: z.string().min(1) }),
    handler: async (params, ctx) => {
      const ticket = await prisma.ticket.findFirst({ where: { id: params.ticketId, orgId: ctx.orgId } });
      if (!ticket) throw new AppError(404, 'Ticket not found');
      const assignee = await prisma.user.findFirst({ where: { id: params.assigneeId, orgId: ctx.orgId, isActive: true } });
      if (!assignee) throw new AppError(404, 'That user was not found in your organization');

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assignedTo: assignee.id, status: 'IN_PROGRESS' },
      });
      return { summary: `Assigned "${ticket.title}" to ${assignee.name}.`, data: updated };
    },
  },

  // ── Change a lead's status ───────────────────────────────────────────────
  {
    name: 'UPDATE_LEAD_STATUS',
    label: 'Change lead status',
    description: 'Changes a lead\'s status (e.g. "mark the John Doe lead as qualified").',
    example: 'Mark the John Doe lead as qualified',
    paramsHint: '{ leadId: string, status: "NEW"|"CONTACTED"|"QUALIFIED"|"UNQUALIFIED"|"CONVERTED" }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      leadId: z.string().min(1),
      status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED']),
    }),
    handler: async (params, ctx) => {
      const existing = await prisma.lead.findFirst({ where: { id: params.leadId, orgId: ctx.orgId }, include: { contact: { select: { name: true } } } });
      if (!existing) throw new AppError(404, 'Lead not found');
      if (existing.status === 'CONVERTED') throw new AppError(400, 'This lead has already been converted — use the Convert flow to make further changes');
      // CONVERTED is a one-way, higher-stakes transition (creates a Deal
      // behind the scenes via the dedicated /leads/:id/convert endpoint) —
      // deliberately not something this quick status-change action performs,
      // to avoid a natural-language misfire accidentally converting a lead.
      if (params.status === 'CONVERTED') throw new AppError(400, 'Converting a lead creates a deal and can\'t be done from a quick status change — use the Convert action on the lead itself');

      const updated = await prisma.lead.update({ where: { id: existing.id }, data: { status: params.status } });
      runWorkflows({
        trigger: 'LEAD_STATUS_CHANGED', orgId: ctx.orgId, entityType: 'LEAD',
        entityId: updated.id, entity: updated as any, previousEntity: existing as any,
      }).catch(() => {});
      return { summary: `Set "${existing.contact?.name || 'lead'}" to ${params.status}.`, data: updated };
    },
  },

  // ── Create a new custom module (no-code object builder) ─────────────────
  {
    name: 'CREATE_CUSTOM_MODULE',
    label: 'Create a custom module',
    description: 'Creates a new custom module — a brand-new record type for data that doesn\'t fit CRM/IT Desk out of the box (e.g. "create a Vendor Contracts module under Admin"). Fields are added separately with ADD_CUSTOM_MODULE_FIELD — a module with no fields yet is invisible to everyone but managers. If the request doesn\'t say which part of the app it belongs to, default navSection to CRM.',
    example: 'Create a Vendor Contracts module under Admin',
    paramsHint: '{ name: string, description?: string, navSection?: "CRM"|"IT_DESK"|"HR"|"ADMIN" (which sidebar section the module\'s link appears under once it has fields — default CRM) }',
    allowedRoles: CRM_MANAGERS,
    requiresConfirmation: true,
    schema: z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(500).optional(),
      navSection: z.enum(['CRM', 'IT_DESK', 'HR', 'ADMIN']).default('CRM'),
    }),
    handler: async (params, ctx) => {
      let slug = slugify(params.name);
      let suffix = 0;
      while (await prisma.customModule.findFirst({ where: { orgId: ctx.orgId, slug: suffix ? `${slug}-${suffix}` : slug } })) {
        suffix += 1;
      }
      if (suffix) slug = `${slug}-${suffix}`;
      const module_ = await prisma.customModule.create({
        data: { orgId: ctx.orgId, name: params.name, slug, icon: 'Layers', description: params.description, navSection: params.navSection, createdBy: ctx.userId },
      });
      return { summary: `Created the "${module_.name}" module under ${params.navSection}. Add fields to it next — it won't show up for other users until it has at least one.`, data: module_ };
    },
  },

  // ── Add a field to an existing custom module ─────────────────────────────
  {
    name: 'ADD_CUSTOM_MODULE_FIELD',
    label: 'Add a field to a custom module',
    description: 'Adds a field to an existing custom module\'s schema (e.g. "add a Claim Amount currency field to Warranty Claims"). Match the module by name from the modules context list.',
    example: 'Add a Claim Amount currency field to Warranty Claims',
    paramsHint: `{ moduleId: string, label: string, fieldType: ${FIELD_TYPES.map(t => `"${t}"`).join('|')}, options?: string[] (DROPDOWN only, the choices), required?: boolean, isPrimary?: boolean (use this field as the record's title in list views) }`,
    allowedRoles: CRM_MANAGERS,
    requiresConfirmation: true,
    schema: z.object({
      moduleId: z.string().min(1),
      label: z.string().min(1).max(80),
      fieldType: z.enum(FIELD_TYPES),
      options: z.array(z.string()).optional(),
      required: z.boolean().default(false),
      isPrimary: z.boolean().default(false),
    }),
    handler: async (params, ctx) => {
      const module_ = await prisma.customModule.findFirst({ where: { id: params.moduleId, orgId: ctx.orgId } });
      if (!module_) throw new AppError(404, 'Custom module not found');

      const fieldKey = slugify(params.label).replace(/-/g, '_');
      const existing = await prisma.customModuleField.findUnique({ where: { moduleId_fieldKey: { moduleId: module_.id, fieldKey } } });
      if (existing) throw new AppError(400, `A field with key "${fieldKey}" already exists on "${module_.name}"`);

      if (params.isPrimary) {
        await prisma.customModuleField.updateMany({ where: { moduleId: module_.id, isPrimary: true }, data: { isPrimary: false } });
      }

      const field = await prisma.customModuleField.create({
        data: {
          moduleId: module_.id, label: params.label, fieldKey, fieldType: params.fieldType,
          options: params.options, required: params.required, isPrimary: params.isPrimary,
        },
      });
      return { summary: `Added "${field.label}" (${field.fieldType}) to "${module_.name}".`, data: field };
    },
  },

  // ── Create a record in a custom module ───────────────────────────────────
  // Pipeline-aware (platform Phase 5): lands the record in a named stage (or
  // the module's first stage), and fires CUSTOM_RECORD_CREATED workflows —
  // exactly like the hand-written createRecord controller, so a record filed
  // from chat triggers the same automations as one typed into the form.
  {
    name: 'CREATE_CUSTOM_MODULE_RECORD',
    label: 'Create a custom module record',
    description: 'Creates a record in an existing custom module (e.g. "add a Vehicle Inventory record for the 2025 Kia EV6 at $41,000, in stock"). Match the module by name and its fields by fieldKey from the modules context list — never invent a fieldKey that isn\'t listed for that module. If the module lists stages and the user names one, set stage to that stage\'s key.',
    example: 'Add a Vehicle Inventory record for the 2025 Kia EV6 at $41,000',
    paramsHint: '{ moduleId: string, data: { [fieldKey]: value }, stage?: string (a stage key from that module\'s stages) }',
    allowedRoles: ALL_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      moduleId: z.string().min(1),
      data: z.record(z.union([z.string(), z.number(), z.boolean()])),
      stage: z.string().max(40).optional(),
    }),
    handler: async (params, ctx) => {
      const module_ = await prisma.customModule.findFirst({ where: { id: params.moduleId, orgId: ctx.orgId } });
      if (!module_) throw new AppError(404, 'Custom module not found');
      const fields = await prisma.customModuleField.findMany({ where: { moduleId: module_.id } });
      if (!fields.length) throw new AppError(400, `"${module_.name}" has no fields defined yet`);

      const data = validateRecordData(fields, params.data);
      const stages = Array.isArray(module_.stages) ? (module_.stages as any[]) : [];
      let stage: string | null = null;
      if (stages.length) {
        if (params.stage && !stages.some(s => s.key === params.stage)) {
          throw new AppError(400, `"${params.stage}" is not a stage of ${module_.name} (stages: ${stages.map(s => s.key).join(', ')})`);
        }
        stage = params.stage ?? stages[0].key;
      }
      const record = await prisma.customModuleRecord.create({
        data: { moduleId: module_.id, orgId: ctx.orgId, data: data as Prisma.InputJsonValue, stage, source: 'MANUAL', createdBy: ctx.userId },
      });
      runWorkflows({
        trigger: 'CUSTOM_RECORD_CREATED', orgId: ctx.orgId, entityType: 'CUSTOM_MODULE_RECORD', entityId: record.id,
        entity: { ...(data as any), id: record.id, moduleId: module_.id, moduleSlug: module_.slug, moduleName: module_.name },
      }).catch(() => {});
      const title = recordTitle(fields, data, record.id);
      const stageLabel = stage ? (stages.find(s => s.key === stage)?.label ?? stage) : null;
      return { summary: `Created "${title}" in ${module_.name}${stageLabel ? ` (${stageLabel})` : ''}.`, data: record };
    },
  },

  // ── Move a custom-module record across its pipeline board ────────────────
  // The chat equivalent of the kanban drag — and it fires the same
  // CUSTOM_RECORD_STAGE_CHANGED automations the drag does.
  {
    name: 'MOVE_CUSTOM_RECORD_STAGE',
    label: 'Move a record to another stage',
    description: 'Moves a custom-module record to another pipeline stage (e.g. "move the 2025 Kia EV6 to reserved"). Match the module from context; use the record\'s id from that module\'s records list when present, else pass its title as recordTitle. stage must be one of the module\'s stage keys.',
    example: 'Move the 2025 Kia EV6 to reserved',
    paramsHint: '{ moduleId: string, recordId?: string, recordTitle?: string, stage: string }',
    allowedRoles: ALL_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      moduleId: z.string().min(1),
      recordId: z.string().optional(),
      recordTitle: z.string().max(200).optional(),
      stage: z.string().min(1).max(40),
    }).refine(p => p.recordId || p.recordTitle, { message: 'recordId or recordTitle is required' }),
    handler: async (params, ctx) => {
      const module_ = await prisma.customModule.findFirst({ where: { id: params.moduleId, orgId: ctx.orgId } });
      if (!module_) throw new AppError(404, 'Custom module not found');
      const stages = Array.isArray(module_.stages) ? (module_.stages as any[]) : [];
      if (!stages.length) throw new AppError(400, `"${module_.name}" has no pipeline stages`);
      if (!stages.some(s => s.key === params.stage)) {
        throw new AppError(400, `"${params.stage}" is not a stage of ${module_.name} (stages: ${stages.map(s => s.key).join(', ')})`);
      }
      const fields = await prisma.customModuleField.findMany({ where: { moduleId: module_.id }, orderBy: { position: 'asc' } });

      let record = params.recordId
        ? await prisma.customModuleRecord.findFirst({ where: { id: params.recordId, moduleId: module_.id } })
        : null;
      if (!record && params.recordTitle) {
        /* Title match in JS rather than a JSON-path query: modules are small
           (bounded fetch), and this gets case-insensitive matching for free. */
        const candidates = await prisma.customModuleRecord.findMany({
          where: { moduleId: module_.id, orgId: ctx.orgId }, orderBy: { updatedAt: 'desc' }, take: 200,
        });
        const needle = params.recordTitle.toLowerCase();
        const matches = candidates.filter(r =>
          recordTitle(fields, r.data as Record<string, unknown>, r.id).toLowerCase().includes(needle));
        if (matches.length === 0) throw new AppError(404, `No ${module_.name} record matches "${params.recordTitle}"`);
        if (matches.length > 1) throw new AppError(400, `"${params.recordTitle}" matches ${matches.length} ${module_.name} records — be more specific`);
        record = matches[0];
      }
      if (!record) throw new AppError(404, 'Record not found');
      const previousStage = record.stage;
      const updated = await prisma.customModuleRecord.update({ where: { id: record.id }, data: { stage: params.stage } });
      runWorkflows({
        trigger: 'CUSTOM_RECORD_STAGE_CHANGED', orgId: ctx.orgId, entityType: 'CUSTOM_MODULE_RECORD', entityId: updated.id,
        entity: {
          ...(updated.data as any), id: updated.id, moduleId: module_.id, moduleSlug: module_.slug, moduleName: module_.name,
          stage: params.stage, previousStage,
        },
      }).catch(() => {});
      const title = recordTitle(fields, updated.data as Record<string, unknown>, updated.id);
      const stageLabel = stages.find(s => s.key === params.stage)?.label ?? params.stage;
      return { summary: `Moved "${title}" to ${stageLabel} on the ${module_.name} board.`, data: updated };
    },
  },

  // ── Create a new account (company/org record) ───────────────────────────
  {
    name: 'CREATE_ACCOUNT',
    label: 'Create an account',
    description: 'Creates a new company/account record (e.g. "create an account called Acme Industries").',
    example: 'Create an account called Acme Industries',
    paramsHint: '{ name: string, industry?: string, website?: string, phone?: string, address?: string }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      name: z.string().min(1).max(120),
      industry: z.string().max(80).optional(),
      website: z.string().max(200).optional(),
      phone: z.string().max(40).optional(),
      address: z.string().max(300).optional(),
    }),
    handler: async (params, ctx) => {
      const account = await prisma.account.create({ data: { ...params, orgId: ctx.orgId, ownerId: ctx.userId } });
      return { summary: `Created the "${account.name}" account.`, data: account };
    },
  },

  // ── Log a call/email/meeting/task activity ───────────────────────────────
  {
    name: 'LOG_ACTIVITY',
    label: 'Log an activity',
    description: 'Logs a call, email, meeting, or task against a deal, contact, or lead (e.g. "log a call with the Acme deal about pricing"). Match the deal/contact/lead by name from the deals/contacts/leads context lists.',
    example: 'Log a call with the Acme deal about pricing',
    paramsHint: '{ type: "CALL"|"EMAIL"|"MEETING"|"TASK", title: string, body?: string, dealId?: string, contactId?: string, leadId?: string, dueAt?: ISO datetime string, done?: boolean }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: true,
    schema: z.object({
      type: z.enum(['CALL', 'EMAIL', 'MEETING', 'TASK']),
      title: z.string().min(1).max(200),
      body: z.string().max(2000).optional(),
      dealId: z.string().optional(),
      contactId: z.string().optional(),
      leadId: z.string().optional(),
      dueAt: z.string().optional(),
      done: z.boolean().optional(),
    }),
    handler: async (params, ctx) => {
      const activity = await prisma.activity.create({
        data: { ...params, dueAt: params.dueAt ? new Date(params.dueAt) : undefined, createdBy: ctx.userId, orgId: ctx.orgId },
      });
      // Mirrors activities.controller.ts's create() — cheap no-op for the
      // (common) case of no calendar connected.
      if (activity.dueAt && !activity.done) {
        pushCalendarEvent(ctx.userId, 'activities', {
          sourceId: `activity-${activity.id}`,
          summary: `[${activity.type}] ${activity.title}`,
          description: activity.body || '',
          start: activity.dueAt,
          end: new Date(activity.dueAt.getTime() + 30 * 60 * 1000),
        }).catch(() => {});
      }
      return { summary: `Logged a ${activity.type.toLowerCase()}: "${activity.title}".`, data: activity };
    },
  },

  // ── Change a quote's status ──────────────────────────────────────────────
  {
    name: 'CHANGE_QUOTE_STATUS',
    label: 'Change quote status',
    description: 'Sets a quote to Draft, Sent, or Rejected (e.g. "mark the Acme quote as sent"). Match the quote by title from the quotes context list. Accepted isn\'t settable here — a quote is only marked Accepted through the customer\'s own signed acceptance link, which also auto-generates its invoice.',
    example: 'Mark the Acme quote as sent',
    paramsHint: '{ quoteId: string, status: "DRAFT"|"SENT"|"REJECTED" }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: true,
    schema: z.object({ quoteId: z.string().min(1), status: z.enum(['DRAFT', 'SENT', 'REJECTED']) }),
    handler: async (params, ctx) => {
      const quote = await prisma.quote.findFirst({ where: { id: params.quoteId, orgId: ctx.orgId } });
      if (!quote) throw new AppError(404, 'Quote not found');
      const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: params.status } });
      return { summary: `Set "${quote.title}" to ${params.status}.`, data: updated };
    },
  },

  // ── Change an invoice's status ───────────────────────────────────────────
  {
    name: 'CHANGE_INVOICE_STATUS',
    label: 'Change invoice status',
    description: 'Sets an invoice\'s status, including marking it paid (e.g. "mark invoice INV-0007 as paid"). Match the invoice by number or title from the invoices context list.',
    example: 'Mark invoice INV-0007 as paid',
    paramsHint: '{ invoiceId: string, status: "DRAFT"|"SENT"|"PAID"|"OVERDUE"|"VOID" }',
    allowedRoles: CRM_STAFF,
    requiresConfirmation: true,
    schema: z.object({ invoiceId: z.string().min(1), status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID']) }),
    handler: async (params, ctx) => {
      const invoice = await prisma.invoice.findFirst({ where: { id: params.invoiceId, orgId: ctx.orgId } });
      if (!invoice) throw new AppError(404, 'Invoice not found');
      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: params.status, paidAt: params.status === 'PAID' ? new Date() : invoice.paidAt },
      });
      return { summary: `Set invoice ${invoice.invoiceNumber} to ${params.status}.`, data: updated };
    },
  },

  // ── Send an email campaign ───────────────────────────────────────────────
  {
    name: 'SEND_CAMPAIGN',
    label: 'Send a campaign',
    description: 'Sends an existing email campaign to its target audience right now (e.g. "send the Spring Promo campaign"). Irreversible once started — match the campaign by name from the campaigns context list.',
    example: 'Send the Spring Promo campaign',
    paramsHint: '{ campaignId: string }',
    allowedRoles: CRM_MANAGERS,
    requiresConfirmation: true,
    schema: z.object({ campaignId: z.string().min(1) }),
    handler: async (params, ctx) => {
      const campaign = await prisma.campaign.findFirst({ where: { id: params.campaignId, orgId: ctx.orgId } });
      if (!campaign) throw new AppError(404, 'Campaign not found');
      if (campaign.status === 'SENT') throw new AppError(400, 'Campaign already sent');
      const { recipients } = await sendCampaignNow(campaign, ctx.orgId);
      return { summary: `Sending "${campaign.name}" to ${recipients} recipient${recipients === 1 ? '' : 's'}.` };
    },
  },

  // ── Create an IT asset ───────────────────────────────────────────────────
  {
    name: 'CREATE_ASSET',
    label: 'Create an asset',
    description: 'Adds a new IT asset to the registry (e.g. "add a Dell XPS 15 laptop asset").',
    example: 'Add a Dell XPS 15 laptop asset',
    paramsHint: '{ name: string, type: string, serialNumber?: string, assignedTo?: string (user id), status?: "active"|"inactive"|"retired"|"in_repair" (default active) }',
    allowedRoles: IT_MANAGERS,
    requiresConfirmation: true,
    schema: z.object({
      name: z.string().min(1).max(120),
      type: z.string().min(1).max(60),
      serialNumber: z.string().max(120).optional(),
      assignedTo: z.string().optional(),
      status: z.enum(['active', 'inactive', 'retired', 'in_repair']).default('active'),
    }),
    handler: async (params, ctx) => {
      const asset = await prisma.asset.create({ data: { ...params, orgId: ctx.orgId } });
      return { summary: `Added the "${asset.name}" asset.`, data: asset };
    },
  },

  // ── Update an asset's status/assignment ──────────────────────────────────
  {
    name: 'UPDATE_ASSET_STATUS',
    label: "Update an asset's status",
    description: 'Changes an asset\'s status or reassigns it to a different user (e.g. "mark the Dell XPS 15 as retired"). Match the asset by name from the assets context list, and the new owner (if any) by name from the orgUsers context list.',
    example: 'Mark the Dell XPS 15 asset as retired',
    paramsHint: '{ assetId: string, status?: "active"|"inactive"|"retired"|"in_repair", assignedTo?: string (user id) }',
    allowedRoles: IT_MANAGERS,
    requiresConfirmation: true,
    schema: z.object({
      assetId: z.string().min(1),
      status: z.enum(['active', 'inactive', 'retired', 'in_repair']).optional(),
      assignedTo: z.string().optional(),
    }),
    handler: async (params, ctx) => {
      const asset = await prisma.asset.findFirst({ where: { id: params.assetId, orgId: ctx.orgId } });
      if (!asset) throw new AppError(404, 'Asset not found');
      const updated = await prisma.asset.update({
        where: { id: asset.id },
        data: { status: params.status, assignedTo: params.assignedTo },
      });
      return { summary: `Updated "${asset.name}".`, data: updated };
    },
  },

  // ── Create a ticket category ─────────────────────────────────────────────
  {
    name: 'CREATE_TICKET_CATEGORY',
    label: 'Create a ticket category',
    description: 'Creates a new IT Desk ticket category (e.g. "create a Network category for tickets").',
    example: 'Create a Network ticket category',
    paramsHint: '{ name: string }',
    allowedRoles: IT_MANAGERS,
    requiresConfirmation: true,
    schema: z.object({ name: z.string().min(1).max(80) }),
    handler: async (params, ctx) => {
      const category = await prisma.category.create({ data: { name: params.name, orgId: ctx.orgId } });
      return { summary: `Created the "${category.name}" category.`, data: category };
    },
  },

  // ── Request leave (self-service) ─────────────────────────────────────────
  {
    name: 'REQUEST_LEAVE',
    label: 'Request leave',
    description: 'Submits a leave request for yourself (e.g. "request annual leave from Sept 1 to Sept 5"). Match the leave type by name from the leaveTypes context list.',
    example: 'Request annual leave from Sept 1 to Sept 5',
    paramsHint: '{ leaveTypeId: string, startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", reason?: string }',
    allowedRoles: ALL_USERS,
    requiresConfirmation: true,
    schema: z.object({
      leaveTypeId: z.string().min(1),
      startDate: z.string().min(1),
      endDate: z.string().min(1),
      reason: z.string().max(500).optional(),
    }),
    handler: async (params, ctx) => {
      const leaveType = await prisma.leaveType.findFirst({ where: { id: params.leaveTypeId, orgId: ctx.orgId, isActive: true } });
      if (!leaveType) throw new AppError(404, 'Leave type not found');
      const [sy, sm, sd] = params.startDate.split('-').map(Number);
      const [ey, em, ed] = params.endDate.split('-').map(Number);
      const startDate = new Date(Date.UTC(sy, sm - 1, sd));
      const endDate = new Date(Date.UTC(ey, em - 1, ed));
      if (endDate < startDate) throw new AppError(400, 'End date must be on or after the start date');
      const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;

      const request = await prisma.leaveRequest.create({
        data: { orgId: ctx.orgId, userId: ctx.userId, leaveTypeId: params.leaveTypeId, startDate, endDate, days, reason: params.reason },
        include: { user: { select: { name: true } } },
      });
      // In-app notification only here (not the email-every-manager loop
      // leave.controller.ts's createRequest also does) — a reasonable trim,
      // not a correctness gap: the request is fully created and visible
      // either way, this just skips a duplicate notification channel.
      notifyOrgAdmins({
        orgId: ctx.orgId, type: 'LEAVE_REQUESTED', title: `${request.user.name} requested ${leaveType.name}`,
        body: `${params.startDate} → ${params.endDate} (${days} day${days === 1 ? '' : 's'})`,
        entityType: 'LEAVE_REQUEST', entityId: request.id,
      }).catch(() => {});
      return { summary: `Requested ${days} day${days === 1 ? '' : 's'} of ${leaveType.name} (${params.startDate} → ${params.endDate}).`, data: request };
    },
  },

  // ── Approve a pending leave request ──────────────────────────────────────
  {
    name: 'APPROVE_LEAVE',
    label: 'Approve a leave request',
    description: 'Approves a pending leave request (e.g. "approve Priya\'s leave request"). Match the request from the pendingLeaveRequests context list.',
    example: "Approve Priya's leave request",
    paramsHint: '{ leaveRequestId: string }',
    allowedRoles: MANAGERS,
    requiresConfirmation: true,
    schema: z.object({ leaveRequestId: z.string().min(1) }),
    handler: async (params, ctx) => {
      const request = await prisma.leaveRequest.findFirst({
        where: { id: params.leaveRequestId, orgId: ctx.orgId },
        include: { leaveType: true, user: { select: { name: true } } },
      });
      if (!request) throw new AppError(404, 'Leave request not found');
      if (request.status !== 'PENDING') throw new AppError(400, `This request is already ${request.status.toLowerCase()}`);
      const updated = await prisma.leaveRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', decidedBy: ctx.userId, decidedAt: new Date() },
      });
      await prisma.notification.create({
        data: { orgId: ctx.orgId, userId: request.userId, type: 'STATUS_CHANGE', title: `Your ${request.leaveType.name} request was approved`, entityId: request.id, entityType: 'LEAVE_REQUEST' },
      });
      return { summary: `Approved ${request.user.name}'s ${request.leaveType.name} request.`, data: updated };
    },
  },

  // ── Reject a pending leave request ───────────────────────────────────────
  {
    name: 'REJECT_LEAVE',
    label: 'Reject a leave request',
    description: 'Rejects a pending leave request with a reason (e.g. "reject Priya\'s leave request, we\'re short-staffed that week"). Match the request from the pendingLeaveRequests context list.',
    example: "Reject Priya's leave request due to coverage",
    paramsHint: '{ leaveRequestId: string, reason: string }',
    allowedRoles: MANAGERS,
    requiresConfirmation: true,
    schema: z.object({ leaveRequestId: z.string().min(1), reason: z.string().min(1).max(500) }),
    handler: async (params, ctx) => {
      const request = await prisma.leaveRequest.findFirst({
        where: { id: params.leaveRequestId, orgId: ctx.orgId },
        include: { leaveType: true, user: { select: { name: true } } },
      });
      if (!request) throw new AppError(404, 'Leave request not found');
      if (request.status !== 'PENDING') throw new AppError(400, `This request is already ${request.status.toLowerCase()}`);
      const updated = await prisma.leaveRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', decidedBy: ctx.userId, decidedAt: new Date(), rejectionReason: params.reason },
      });
      await prisma.notification.create({
        data: { orgId: ctx.orgId, userId: request.userId, type: 'STATUS_CHANGE', title: `Your ${request.leaveType.name} request was rejected`, body: params.reason, entityId: request.id, entityType: 'LEAVE_REQUEST' },
      });
      return { summary: `Rejected ${request.user.name}'s ${request.leaveType.name} request.`, data: updated };
    },
  },

  // ── Manual attendance entry (manager exception path) ─────────────────────
  {
    name: 'MANUAL_ATTENDANCE_ENTRY',
    label: 'Add a manual attendance entry',
    description: 'Adds a manual attendance session for an employee, bypassing the usual office-location/network checks (e.g. "log John as present today from 9 to 5"). Match the employee by name from the orgUsers context list. Self check-in/out isn\'t an AI action — it requires the employee\'s real device location, which the AI has no way to provide.',
    example: 'Log John as present today from 9am to 5pm',
    paramsHint: '{ userId: string, date: "YYYY-MM-DD", checkInAt?: ISO datetime string, checkOutAt?: ISO datetime string, notes?: string }',
    allowedRoles: MANAGERS,
    requiresConfirmation: true,
    schema: z.object({
      userId: z.string().min(1),
      date: z.string().min(1),
      checkInAt: z.string().optional(),
      checkOutAt: z.string().optional(),
      notes: z.string().max(300).optional(),
    }),
    handler: async (params, ctx) => {
      const target = await prisma.user.findFirst({ where: { id: params.userId, orgId: ctx.orgId } });
      if (!target) throw new AppError(404, 'User not found');
      const [y, m, d] = params.date.split('-').map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      const record = await prisma.attendanceRecord.create({
        data: {
          orgId: ctx.orgId, userId: params.userId, date,
          checkInAt: params.checkInAt ? new Date(params.checkInAt) : undefined,
          checkOutAt: params.checkOutAt ? new Date(params.checkOutAt) : undefined,
          notes: params.notes, source: 'MANUAL',
        },
      });
      return { summary: `Added a manual attendance entry for ${target.name} on ${params.date}.`, data: record };
    },
  },
];

export function getAiAction(name: string): AiActionDefinition | undefined {
  return AI_ACTIONS.find(a => a.name === name);
}

/** Menu shape handed to the LLM planner — name/description/params only, no handler/roles leaked into the prompt. */
export function actionMenuForPrompt() {
  return AI_ACTIONS.map(a => ({ name: a.name, description: a.description, params: a.paramsHint }));
}

/**
 * List shape handed to the AI Command Bar's "what can I say" help panel
 * (GET /api/ai/actions — ai.controller.ts's listActionsHandler). Filtered to
 * whatever this specific user's role could actually run, same allowedRoles
 * check executeActionHandler already does — showing an example the user's
 * own role can't trigger would just be confusing. No schema/handler leaked,
 * same as actionMenuForPrompt above.
 */
export function listActionsForRole(role: string) {
  return AI_ACTIONS
    .filter(a => a.allowedRoles.includes(role as any))
    .map(a => ({ name: a.name, label: a.label, description: a.description, example: a.example }));
}
