import { Response, NextFunction } from 'express';
import { runAiRules } from '../../../utils/ai-rules';
import { z } from 'zod';
import { sanitizeRichText } from '../../../utils/sanitizeHtml';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { sendMail, emailTemplates } from '../../../utils/mailer';
import { parsePagination, paginate } from '../../../utils/pagination';
import { runWorkflows } from '../../../utils/workflow-engine';
import { sseManager, SSEEvent } from '../../../utils/sse';
import { notifyOrgAdmins } from '../../notifications/notifications.controller';
import { slackNewTicket } from '../../../utils/slack';
import { logAction } from '../../../utils/auditLog';
import { purgeEntityChildren } from '../../../utils/entityCleanup';
import { tagIdFilter } from '../../../utils/tagFilter';

const Schema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  categoryId: z.string().optional(),
  priority: z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).optional(),
  // "Create on behalf of" — an agent/manager can submit a ticket as if
  // filed by another User (requesterId) or link it to a CRM Contact
  // (contactId) instead of themselves. Both optional and both gated to
  // IT_STAFF in create() below — an EMPLOYEE self-service submitter can't
  // spoof who a ticket is "from".
  requesterId: z.string().optional(),
  contactId: z.string().optional().or(z.literal('')).transform(v => v || undefined),
  // Which department the request is raised to (IT, HR, Facilities…) —
  // validated against the org's Department list below; '' clears it.
  departmentId: z.string().optional().or(z.literal('')).transform(v => v || undefined),
});

const include = {
  requester: { select: { id: true, name: true, email: true } },
  contact: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  category: { select: { id: true, name: true, slaPolicy: true } },
  department: { select: { id: true, name: true } },
};

/** departmentId must be one of this org's active departments, or undefined. */
async function assertDepartmentInOrg(departmentId: string | undefined, orgId: string) {
  if (!departmentId) return undefined;
  const dep = await prisma.department.findFirst({ where: { id: departmentId, orgId }, select: { id: true } });
  if (!dep) throw new AppError(400, 'Department not found in this organization');
  return dep.id;
}

function calcSlaDue(resolutionHours: number) {
  const due = new Date();
  due.setHours(due.getHours() + resolutionHours);
  return due;
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { status, priority, assignedTo, requesterId, tagId, departmentId } = req.query as Record<string, string>;
    const where: any = { orgId };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignedTo) where.assignedTo = assignedTo;
    if (requesterId) where.requesterId = requesterId;
    if (departmentId) where.departmentId = departmentId;
    if (req.user!.role === 'EMPLOYEE') where.requesterId = req.user!.id;
    // ?tagId=a,b narrows to records carrying every listed tag. Merged
    // into `where` as an id set, since tags are polymorphic rather than
    // a relation on this model — see utils/tagFilter.ts.
    const byTag = await tagIdFilter(orgId, 'TICKET', tagId);
    if (byTag) Object.assign(where, byTag);
    const pag = parsePagination(req);
    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.ticket.count({ where }),
    ]);
    res.json(paginate(tickets, total, pag));
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const raw = Schema.parse(req.body);
    // Coerce empty string to undefined so Prisma receives null, not a bad FK
    const { requesterId: requestedRequesterId, contactId: requestedContactId, ...rest } = raw;
    const data = { ...rest, categoryId: raw.categoryId || undefined };

    // "On behalf of" overrides are staff-only — an EMPLOYEE (self-service
    // submitter, also covered by requireRole(...ALL_USERS) on this route)
    // can't set who a ticket is filed as/for; it always defaults to
    // themselves regardless of what's in the request body.
    const isStaff = ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'].includes(req.user!.role);
    let requesterId = req.user!.id;
    let contactId: string | undefined;
    if (isStaff) {
      if (requestedRequesterId) {
        const requestedUser = await prisma.user.findFirst({ where: { id: requestedRequesterId, orgId } });
        if (!requestedUser) throw new AppError(400, 'Requester not found in your organization');
        requesterId = requestedUser.id;
      }
      if (requestedContactId) {
        const contact = await prisma.contact.findFirst({ where: { id: requestedContactId, orgId } });
        if (!contact) throw new AppError(400, 'Contact not found in your organization');
        contactId = contact.id;
      }
    }

    let slaDueAt: Date | undefined;
    if (data.categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: data.categoryId, orgId }, include: { slaPolicy: true } });
      if (cat?.slaPolicy) slaDueAt = calcSlaDue(cat.slaPolicy.resolutionHours);
    }
    // Department is open to every role — an employee raising a request picks
    // which department it goes to — but always validated against this org.
    const departmentId = await assertDepartmentInOrg(data.departmentId, orgId);
    const ticket = await prisma.ticket.create({
      data: { ...data, departmentId, orgId, requesterId, contactId, slaDueAt },
      include
    });
    await prisma.ticketHistory.create({ data: { ticketId: ticket.id, toStatus: 'OPEN', changedBy: req.user!.id } });
    const managers = await prisma.user.findMany({ where: { orgId, role: { in: ['IT_MANAGER', 'SUPER_ADMIN'] }, isActive: true } });
    managers.forEach(m => sendMail({ ...emailTemplates.ticketCreated(ticket, ticket.requester.name, m.email), orgId }).catch(() => {}));
    // Fire workflows + SSE in background. departmentName is flattened onto
    // the entity so rules can condition on the human-readable name
    // ("departmentName equals IT") instead of an opaque id.
    runWorkflows({ trigger: 'TICKET_CREATED', orgId, entityType: 'TICKET', entityId: ticket.id, entity: { ...(ticket as any), departmentName: (ticket as any).department?.name ?? null } }).catch(() => {});
    // AI Custom Rules run alongside workflow rules on the same events.
    runAiRules({ trigger: 'TICKET_CREATED', orgId: req.user!.orgId, entityType: 'TICKET', entityId: ticket.id, entity: ticket as any, userId: req.user!.id });
    sseManager.broadcastAll(orgId, SSEEvent.TICKET_CREATED, { id: ticket.id, title: ticket.title, priority: ticket.priority, status: ticket.status });
    notifyOrgAdmins({ orgId, type: 'TICKET_CREATED', title: `New ticket: ${ticket.title}`, body: `Priority: ${ticket.priority}`, entityType: 'TICKET', entityId: ticket.id }).catch(() => {});
    slackNewTicket(orgId, { id: ticket.id, title: ticket.title, priority: ticket.priority, requester: ticket.requester }).catch(() => {});
    logAction(req.user!.id, 'CREATE', 'Ticket', ticket.id, { title: ticket.title, priority: ticket.priority });
    res.status(201).json(ticket);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: { ...include, history: { orderBy: { changedAt: 'desc' } } }
    });
    if (!ticket) throw new AppError(404, 'Ticket not found');
    res.json(ticket);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    if (data.body) data.body = sanitizeRichText(data.body);
    const orgId = req.user!.orgId;
    const existing = await prisma.ticket.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Ticket not found');
    // '' arrives as undefined via the schema transform; an explicit null
    // never reaches here, so a set department can be changed but a partial
    // update that omits it leaves it alone. Validate any new value.
    if (data.departmentId !== undefined) {
      (data as any).departmentId = await assertDepartmentInOrg(data.departmentId, orgId);
    }

    await prisma.ticket.updateMany({ where: { id: req.params.id, orgId }, data });
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, include });
    logAction(req.user!.id, 'UPDATE', 'Ticket', req.params.id, data as Record<string, unknown>);

    /* TICKET_UPDATED was offered in the rule builder, accepted by the API and
       shown as "Active" with a run counter — and nothing in the codebase ever
       emitted it. A rule on it never fired and never logged, so there was
       nothing for the user to inspect. */
    if (ticket) {
      runWorkflows({
        trigger: 'TICKET_UPDATED',
        orgId,
        entityType: 'TICKET',
        entityId: ticket.id,
        entity: ticket,
        previousEntity: existing,
      }).catch(() => {});

      // No status branch needed here: this endpoint's schema has no `status`
      // field, so a ticket's status can only move through changeStatus(),
      // which already fires TICKET_STATUS_CHANGED.
    }

    res.json(ticket);
  } catch (err) { next(err); }
}

export async function changeStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = z.object({ status: z.enum(['OPEN','IN_PROGRESS','PENDING','RESOLVED','CLOSED']) }).parse(req.body);
    const existing = await prisma.ticket.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Ticket not found');
    const data: any = { status };
    if (status === 'RESOLVED') data.resolvedAt = new Date();
    if (status === 'CLOSED') data.closedAt = new Date();
    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data, include });
    await prisma.ticketHistory.create({ data: { ticketId: ticket.id, fromStatus: existing.status, toStatus: status, changedBy: req.user!.id } });
    if (status === 'RESOLVED') {
      runAiRules({ trigger: 'TICKET_RESOLVED', orgId: req.user!.orgId, entityType: 'TICKET', entityId: ticket.id, entity: ticket as any, userId: req.user!.id });
    }
    runWorkflows({ trigger: 'TICKET_STATUS_CHANGED', orgId: req.user!.orgId, entityType: 'TICKET', entityId: ticket.id, entity: ticket as any, previousEntity: existing as any }).catch(() => {});
    sseManager.broadcastAll(req.user!.orgId, SSEEvent.TICKET_STATUS, { id: ticket.id, title: ticket.title, status, previousStatus: existing.status });
    notifyOrgAdmins({ orgId: req.user!.orgId, type: 'TICKET_STATUS', title: `Ticket "${ticket.title}" → ${status}`, entityType: 'TICKET', entityId: ticket.id }).catch(() => {});
    if (status === 'RESOLVED' && ticket.requester?.email) {
      sendMail({ ...emailTemplates.ticketResolved(ticket, ticket.requester.name, ticket.requester.email), orgId: req.user!.orgId }).catch(() => {});
      // Feedback survey is no longer hardcoded here — it's a SEND_CSAT_SURVEY
      // workflow action (see workflow-engine.ts), fired via the
      // TICKET_STATUS_CHANGED runWorkflows() call above. Configurable per
      // org: condition it on status/category, or turn it off entirely, from
      // the Workflows UI rather than a code change.
    } else if (ticket.requester?.email) {
      sendMail({ ...emailTemplates.ticketStatusChanged(ticket, status, ticket.requester.name, ticket.requester.email), orgId: req.user!.orgId }).catch(() => {});
    }
    res.json(ticket);
  } catch (err) { next(err); }
}

export async function assign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { assignedTo } = z.object({ assignedTo: z.string() }).parse(req.body);
    const orgId = req.user!.orgId;

    /* Was `update({ where: { id } })` with no orgId — a cross-org write: any
       authenticated user could reassign another organisation's ticket by id.
       Every other ticket mutation in this file scopes by orgId; this one was
       missed. */
    const existing = await prisma.ticket.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Ticket not found');

    // The assignee must also be in this org, or the ticket ends up owned by
    // somebody who cannot see it.
    const assignee = await prisma.user.findFirst({ where: { id: assignedTo, orgId }, select: { id: true } });
    if (!assignee) throw new AppError(400, 'That user is not in your organization');

    const previousStatus = existing.status;
    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data: { assignedTo, status: 'IN_PROGRESS' },
      include
    });
    if (ticket.assignee?.email) {
      sendMail({ ...emailTemplates.ticketAssigned(ticket, ticket.assignee.name, ticket.assignee.email), orgId }).catch(() => {});
    }

    /* Assigning moves the ticket to IN_PROGRESS, which IS a status change —
       but this path never told the automation engine, so TICKET_STATUS_CHANGED
       rules silently skipped every assignment. */
    if (previousStatus !== ticket.status) {
      runWorkflows({
        trigger: 'TICKET_STATUS_CHANGED',
        orgId,
        entityType: 'TICKET',
        entityId: ticket.id,
        entity: ticket,
        previousEntity: existing,
      }).catch(() => {});
    }

    res.json(ticket);
  } catch (err) { next(err); }
}

export async function reports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const [open, inProgress, resolved, closed] = await Promise.all([
      prisma.ticket.count({ where: { orgId, status: 'OPEN' } }),
      prisma.ticket.count({ where: { orgId, status: 'IN_PROGRESS' } }),
      prisma.ticket.count({ where: { orgId, status: 'RESOLVED' } }),
      prisma.ticket.count({ where: { orgId, status: 'CLOSED' } }),
    ]);
    const byPriority = await prisma.ticket.groupBy({ by: ['priority'], _count: true, where: { orgId, status: { in: ['OPEN','IN_PROGRESS'] } } });
    const slaBreached = await prisma.ticket.count({ where: { orgId, slaDueAt: { lt: new Date() }, status: { notIn: ['RESOLVED','CLOSED'] } } });
    res.json({ open, inProgress, resolved, closed, byPriority, slaBreached });
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.ticket.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('TICKET', req.params.id, req.user!.orgId);
    logAction(req.user!.id, 'DELETE', 'Ticket', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
