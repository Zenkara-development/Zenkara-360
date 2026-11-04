import { Response, NextFunction } from 'express';
import { assertEntityInOrg } from '../../utils/entityAccess';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { parsePagination, paginate } from '../../utils/pagination';
import { getPermCtx, assertCan, scopedWhere, canAccessRecord } from '../../utils/permissions';
import { createNotification } from '../notifications/notifications.controller';
import { purgeEntityChildren } from '../../utils/entityCleanup';

/**
 * Universal tasks (§47) — one task model every module shares.
 *
 * The polymorphic entityType/entityId is what makes onboarding, offboarding
 * and "follow up on this deal" the same feature rather than three. It also
 * means `GET /tasks?entityType=DEAL&entityId=x` is the deal's task list, with
 * no per-module table.
 */

const ENTITY_TYPES = [
  'DEAL',
  'TICKET',
  'CONTACT',
  'LEAD',
  'ACCOUNT',
  'CHANGE_REQUEST',
  'QUOTE',
  'ASSET',
  'CAMPAIGN',
  'EMPLOYEE',
  'TASK',
  'APPROVAL_REQUEST',
  'DEPARTMENT',
  'INVOICE',
] as const;

const ChecklistItem = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean().default(false),
  doneAt: z.string().optional().nullable(),
  doneBy: z.string().optional().nullable(),
});

const CreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional().nullable(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  startAt: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
  assigneeUserId: z.string().optional().nullable(),
  assigneeEmployeeId: z.string().optional().nullable(),
  entityType: z.enum(ENTITY_TYPES).optional().nullable(),
  entityId: z.string().optional().nullable(),
  parentTaskId: z.string().optional().nullable(),
  checklist: z.array(ChecklistItem).optional().nullable(),
  recurrenceRule: z.string().optional().nullable(),
  recurrenceUntil: z.string().optional().nullable(),
  estimateMinutes: z.number().int().positive().optional().nullable(),
  tags: z.array(z.string()).optional(),
  dependsOnTaskIds: z.array(z.string()).optional(),
});

const UpdateSchema = CreateSchema.partial();

const include = {
  assigneeUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
  assigneeEmployee: { select: { id: true, displayName: true, employeeCode: true } },
  creator: { select: { id: true, name: true } },
  subtasks: { select: { id: true, title: true, status: true } },
  dependsOn: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
};

function toDate(v?: string | null): Date | undefined {
  return v ? new Date(v) : undefined;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.read');

    const orgId = req.user!.orgId;
    const { status, priority, assigneeUserId, entityType, entityId, search, overdue, scope } =
      req.query as Record<string, string>;

    const where: any = { orgId, ...scopedWhere(ctx, 'task', 'core.task.read') };

    // `scope=mine` narrows further than the permission scope — a manager who
    // *can* see the team's tasks still wants their own list by default.
    if (scope === 'mine') {
      where.OR = [
        { assigneeUserId: req.user!.id },
        ...(ctx.employeeId ? [{ assigneeEmployeeId: ctx.employeeId }] : []),
      ];
    }

    if (status) where.status = { in: status.split(',') };
    if (priority) where.priority = { in: priority.split(',') };
    if (assigneeUserId) where.assigneeUserId = assigneeUserId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (overdue === 'true') {
      where.dueAt = { lt: new Date() };
      where.status = { notIn: ['DONE', 'CANCELLED'] };
    }
    if (search) {
      where.AND = [
        {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const pag = parsePagination(req);
    const [rows, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include,
        // Nulls-last on dueAt so undated tasks don't crowd out the ones that
        // actually have a deadline.
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { createdAt: 'desc' }],
        take: pag.limit,
        skip: pag.skip,
      }),
      prisma.task.count({ where }),
    ]);

    res.json(paginate(rows, total, pag));
  } catch (err) {
    next(err);
  }
}

/**
 * "My Work" — the personal cross-module queue (§2).
 *
 * Everything assigned to this person that isn't finished, bucketed by when it
 * is due, plus the approvals waiting on them. This is the query the Employee
 * and Manager home dashboards are built on.
 */
export async function myWork(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    const orgId = req.user!.orgId;

    const mine: any = {
      orgId,
      status: { notIn: ['DONE', 'CANCELLED'] },
      OR: [
        { assigneeUserId: req.user!.id },
        ...(ctx.employeeId ? [{ assigneeEmployeeId: ctx.employeeId }] : []),
      ],
    };

    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(endOfToday.getTime() + 6 * 86_400_000);

    const [overdue, today, thisWeek, later, noDate, counts] = await Promise.all([
      prisma.task.findMany({ where: { ...mine, dueAt: { lt: now } }, include, orderBy: { dueAt: 'asc' }, take: 50 }),
      prisma.task.findMany({
        where: { ...mine, dueAt: { gte: now, lte: endOfToday } },
        include,
        orderBy: { dueAt: 'asc' },
        take: 50,
      }),
      prisma.task.findMany({
        where: { ...mine, dueAt: { gt: endOfToday, lte: endOfWeek } },
        include,
        orderBy: { dueAt: 'asc' },
        take: 50,
      }),
      prisma.task.findMany({ where: { ...mine, dueAt: { gt: endOfWeek } }, include, orderBy: { dueAt: 'asc' }, take: 25 }),
      prisma.task.findMany({ where: { ...mine, dueAt: null }, include, orderBy: { createdAt: 'desc' }, take: 25 }),
      prisma.task.groupBy({ by: ['status'], where: { orgId, ...mine }, _count: { _all: true } }),
    ]);

    const { pendingForUser } = await import('../../utils/approvals');
    const approvals = await pendingForUser(orgId, req.user!.id);

    res.json({
      overdue,
      today,
      thisWeek,
      later,
      noDate,
      approvals,
      counts: {
        overdue: overdue.length,
        today: today.length,
        thisWeek: thisWeek.length,
        approvals: approvals.length,
        byStatus: counts.map(c => ({ status: c.status, count: c._count._all })),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.read');
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include,
    });
    if (!task) throw new AppError(404, 'Task not found');
    if (!canAccessRecord(ctx, 'task', 'core.task.read', task)) throw new AppError(403, 'Insufficient permissions');
    res.json(task);
  } catch (err) {
    next(err);
  }
}

export async function stats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.read');
    const orgId = req.user!.orgId;
    const where = { orgId, ...scopedWhere(ctx, 'task', 'core.task.read') };

    const [byStatus, byPriority, overdue, dueToday] = await Promise.all([
      prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.task.groupBy({ by: ['priority'], where, _count: { _all: true } }),
      prisma.task.count({ where: { ...where, dueAt: { lt: new Date() }, status: { notIn: ['DONE', 'CANCELLED'] } } }),
      prisma.task.count({
        where: {
          ...where,
          dueAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lte: new Date(new Date().setHours(23, 59, 59, 999)) },
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
      }),
    ]);

    res.json({
      byStatus: byStatus.map(s => ({ status: s.status, count: s._count._all })),
      byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count._all })),
      overdue,
      dueToday,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.create');

    const orgId = req.user!.orgId;
    const data = CreateSchema.parse(req.body);

    if (data.entityType && !data.entityId) throw new AppError(400, 'entityId is required when entityType is set');

    /* Confirm the record being linked to is actually this org's.
       Only the *presence* of entityId was checked, so a task could be attached
       to another tenant's record id — and because GET /tasks filters by
       entityType+entityId, that task would then surface on their record. Every
       other polymorphic feature (comments, attachments) already routes through
       this guard; tasks were missed. */
    if (data.entityType && data.entityId) {
      await assertEntityInOrg(data.entityType, data.entityId, orgId);
    }

    const task = await prisma.task.create({
      data: {
        orgId,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? 'OPEN',
        priority: data.priority ?? 'MEDIUM',
        startAt: toDate(data.startAt),
        dueAt: toDate(data.dueAt),
        assigneeUserId: data.assigneeUserId ?? null,
        assigneeEmployeeId: data.assigneeEmployeeId ?? null,
        createdBy: req.user!.id,
        entityType: (data.entityType as any) ?? null,
        entityId: data.entityId ?? null,
        parentTaskId: data.parentTaskId ?? null,
        checklist: (data.checklist as any) ?? undefined,
        recurrenceRule: data.recurrenceRule ?? null,
        recurrenceUntil: toDate(data.recurrenceUntil),
        estimateMinutes: data.estimateMinutes ?? null,
        tags: data.tags ?? [],
      },
      include,
    });

    if (data.dependsOnTaskIds?.length) {
      await prisma.taskDependency.createMany({
        data: data.dependsOnTaskIds.map(id => ({ taskId: task.id, dependsOnTaskId: id })),
        skipDuplicates: true,
      });
    }

    if (task.assigneeUserId && task.assigneeUserId !== req.user!.id) {
      await createNotification({
        orgId,
        userId: task.assigneeUserId,
        type: 'ASSIGNMENT',
        title: 'New task assigned',
        body: task.title,
        entityType: 'TASK',
        entityId: task.id,
      }).catch(() => {});
    }

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.update');

    const orgId = req.user!.orgId;
    const existing = await prisma.task.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Task not found');
    if (!canAccessRecord(ctx, 'task', 'core.task.update', existing)) {
      throw new AppError(403, 'Insufficient permissions');
    }

    const data = UpdateSchema.parse(req.body);

    // A FINISH_TO_START dependency that isn't satisfied should block
    // completion — otherwise the dependency is decorative.
    if (data.status === 'DONE' && existing.status !== 'DONE') {
      const blockers = await prisma.taskDependency.findMany({
        where: { taskId: existing.id, type: 'FINISH_TO_START' },
        include: { dependsOn: { select: { id: true, title: true, status: true } } },
      });
      const unfinished = blockers.filter(b => !['DONE', 'CANCELLED'].includes(b.dependsOn.status));
      if (unfinished.length) {
        throw new AppError(
          400,
          `Blocked by ${unfinished.length} unfinished task(s): ${unfinished.map(u => u.dependsOn.title).join(', ')}`
        );
      }
    }

    /* Re-linking. UpdateSchema accepted entityType/entityId (it is
       CreateSchema.partial()) but the update never applied them, so a task's
       record link was fixed at creation — you could not attach an existing
       task to a deal, or detach one filed against the wrong record.
       Same org guard as create: pass entityType: null to detach. */
    const relinking = data.entityType !== undefined || data.entityId !== undefined;
    if (relinking) {
      const nextType = data.entityType ?? null;
      const nextId = data.entityId ?? null;
      if (nextType && !nextId) throw new AppError(400, 'entityId is required when entityType is set');
      if (nextType && nextId) await assertEntityInOrg(nextType, nextId, orgId);
    }

    const completing = data.status === 'DONE' && existing.status !== 'DONE';
    const reopening = data.status && data.status !== 'DONE' && existing.status === 'DONE';

    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.startAt !== undefined ? { startAt: toDate(data.startAt) ?? null } : {}),
        ...(data.dueAt !== undefined ? { dueAt: toDate(data.dueAt) ?? null } : {}),
        ...(data.assigneeUserId !== undefined ? { assigneeUserId: data.assigneeUserId } : {}),
        ...(data.assigneeEmployeeId !== undefined ? { assigneeEmployeeId: data.assigneeEmployeeId } : {}),
        ...(data.checklist !== undefined ? { checklist: (data.checklist as any) ?? undefined } : {}),
        ...(data.estimateMinutes !== undefined ? { estimateMinutes: data.estimateMinutes } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(relinking ? { entityType: (data.entityType as any) ?? null, entityId: data.entityId ?? null } : {}),
        ...(completing ? { completedAt: new Date() } : {}),
        ...(reopening ? { completedAt: null } : {}),
      },
      include,
    });

    if (completing && task.recurrenceRule) await spawnNextOccurrence(task);

    if (
      data.assigneeUserId &&
      data.assigneeUserId !== existing.assigneeUserId &&
      data.assigneeUserId !== req.user!.id
    ) {
      await createNotification({
        orgId,
        userId: data.assigneeUserId,
        type: 'ASSIGNMENT',
        title: 'Task assigned to you',
        body: task.title,
        entityType: 'TASK',
        entityId: task.id,
      }).catch(() => {});
    }

    res.json(task);
  } catch (err) {
    next(err);
  }
}

/**
 * Creates the next instance of a recurring task on completion.
 *
 * Chained off completion rather than generated in advance so a recurring task
 * that nobody ever does doesn't silently accumulate 200 open rows.
 */
async function spawnNextOccurrence(task: {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  priority: any;
  dueAt: Date | null;
  recurrenceRule: string | null;
  recurrenceUntil: Date | null;
  recurrenceParentId: string | null;
  assigneeUserId: string | null;
  assigneeEmployeeId: string | null;
  createdBy: string;
  entityType: any;
  entityId: string | null;
  checklist: any;
  tags: string[];
}): Promise<void> {
  const rule = task.recurrenceRule ?? '';
  const freq = /FREQ=(\w+)/.exec(rule)?.[1];
  const interval = parseInt(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? '1', 10) || 1;
  if (!freq) return;

  const base = task.dueAt ?? new Date();
  const next = new Date(base);
  if (freq === 'DAILY') next.setDate(next.getDate() + interval);
  else if (freq === 'WEEKLY') next.setDate(next.getDate() + 7 * interval);
  else if (freq === 'MONTHLY') next.setMonth(next.getMonth() + interval);
  else if (freq === 'YEARLY') next.setFullYear(next.getFullYear() + interval);
  else return;

  if (task.recurrenceUntil && next > task.recurrenceUntil) return;

  // Reset checklist ticks — a recurring checklist starts fresh each cycle.
  const checklist = Array.isArray(task.checklist)
    ? task.checklist.map((i: any) => ({ ...i, done: false, doneAt: null, doneBy: null }))
    : undefined;

  await prisma.task.create({
    data: {
      orgId: task.orgId,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueAt: next,
      assigneeUserId: task.assigneeUserId,
      assigneeEmployeeId: task.assigneeEmployeeId,
      createdBy: task.createdBy,
      entityType: task.entityType,
      entityId: task.entityId,
      checklist: checklist as any,
      recurrenceRule: task.recurrenceRule,
      recurrenceUntil: task.recurrenceUntil,
      recurrenceParentId: task.recurrenceParentId ?? task.id,
      source: 'RECURRENCE',
      tags: task.tags,
    },
  });
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.delete');
    const existing = await prisma.task.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Task not found');
    if (!canAccessRecord(ctx, 'task', 'core.task.delete', existing)) {
      throw new AppError(403, 'Insufficient permissions');
    }
    await prisma.task.delete({ where: { id: existing.id } });
    // A task is itself a comment/attachment parent — those rows would
    // otherwise outlive it with no way to reach or delete them.
    await purgeEntityChildren('TASK', existing.id, req.user!.orgId);
    res.json({ message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
}

const BulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeUserId: z.string().optional().nullable(),
});

export async function bulkUpdate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.update');
    const orgId = req.user!.orgId;
    const data = BulkSchema.parse(req.body);

    // Scope is re-applied here rather than trusted from the client: a bulk
    // endpoint that takes ids and updates them is the classic way a
    // record-level rule gets bypassed.
    const result = await prisma.task.updateMany({
      where: { id: { in: data.ids }, orgId, ...scopedWhere(ctx, 'task', 'core.task.update') },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.assigneeUserId !== undefined ? { assigneeUserId: data.assigneeUserId } : {}),
        ...(data.status === 'DONE' ? { completedAt: new Date() } : {}),
      },
    });

    res.json({ updated: result.count, requested: data.ids.length });
  } catch (err) {
    next(err);
  }
}

const ChecklistToggleSchema = z.object({ itemId: z.string(), done: z.boolean() });

export async function toggleChecklistItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.task.update');
    const task = await prisma.task.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!task) throw new AppError(404, 'Task not found');

    const { itemId, done } = ChecklistToggleSchema.parse(req.body);
    const items = Array.isArray(task.checklist) ? (task.checklist as any[]) : [];
    const updated = items.map(i =>
      i.id === itemId ? { ...i, done, doneAt: done ? new Date().toISOString() : null, doneBy: done ? req.user!.id : null } : i
    );

    const saved = await prisma.task.update({
      where: { id: task.id },
      data: { checklist: updated as any },
      include,
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
}
