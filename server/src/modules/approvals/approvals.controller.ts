import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { parsePagination, paginate } from '../../utils/pagination';
import { logAction } from '../../utils/auditLog';
import { runWorkflows } from '../../utils/workflow-engine';
import { getPermCtx, assertCan, scopedWhere } from '../../utils/permissions';
import { requestApproval, decide, pendingForUser } from '../../utils/approvals';

/**
 * HTTP surface for the approval engine (§46).
 *
 * Policies are admin-configured; requests are created by whichever module owns
 * the record, and decided here. The decide endpoint is deliberately the only
 * write path for a decision — every authorization rule about *who may approve*
 * lives in utils/approvals.ts, so it cannot be bypassed by a module choosing
 * to flip a status column itself.
 */

const APPROVAL_ENTITY_TYPES = [
  'LEAVE_REQUEST',
  'CHANGE_REQUEST',
  'QUOTE',
  'EXPENSE',
  'SERVICE_REQUEST',
  'TASK',
  'PURCHASE',
  'ONBOARDING',
  'OFFBOARDING',
  'CUSTOM',
] as const;

const ConditionSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
  value: z.any(),
});

const StepSchema = z.object({
  order: z.number().int().min(1),
  name: z.string().min(1),
  approverType: z.enum([
    'USER',
    'ROLE',
    'MANAGER',
    'SKIP_LEVEL_MANAGER',
    'DEPARTMENT_HEAD',
    'TEAM_LEAD',
    'DYNAMIC_FIELD',
  ]),
  approverUserId: z.string().optional().nullable(),
  approverRoleKey: z.string().optional().nullable(),
  approverField: z.string().optional().nullable(),
  minApprovals: z.number().int().min(1).optional(),
  isOptional: z.boolean().optional(),
  conditions: z.array(ConditionSchema).optional().nullable(),
});

const PolicySchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().optional().nullable(),
  entityType: z.enum(APPROVAL_ENTITY_TYPES),
  mode: z.enum(['SEQUENTIAL', 'PARALLEL', 'ANY_ONE', 'UNANIMOUS']).optional(),
  conditions: z.array(ConditionSchema).optional().nullable(),
  priority: z.number().int().optional(),
  expiryHours: z.number().int().positive().optional().nullable(),
  escalateAfterHours: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
  steps: z.array(StepSchema).min(1),
});

// ═══ Policies ════════════════════════════════════════════════════════════════

export async function listPolicies(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.approval.read');
    const rows = await prisma.approvalPolicy.findMany({
      where: { orgId: req.user!.orgId },
      include: { steps: { orderBy: { order: 'asc' } }, _count: { select: { requests: true } } },
      orderBy: [{ entityType: 'asc' }, { priority: 'desc' }],
    });
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function createPolicy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.approval.create');
    const orgId = req.user!.orgId;
    const { steps, ...policy } = PolicySchema.parse(req.body);

    validateSteps(steps);

    const created = await prisma.approvalPolicy.create({
      data: {
        ...policy,
        orgId,
        conditions: (policy.conditions as any) ?? undefined,
        steps: {
          create: steps.map(s => ({
            order: s.order,
            name: s.name,
            approverType: s.approverType,
            approverUserId: s.approverUserId ?? null,
            approverRoleKey: s.approverRoleKey ?? null,
            approverField: s.approverField ?? null,
            minApprovals: s.minApprovals ?? 1,
            isOptional: s.isOptional ?? false,
            conditions: (s.conditions as any) ?? undefined,
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    logAction(req.user!.id, 'CREATE', 'APPROVAL_POLICY', created.id, { name: created.name });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

/** A step that can never resolve an approver would silently strand requests. */
function validateSteps(steps: z.infer<typeof StepSchema>[]): void {
  const seen = new Set<number>();
  for (const s of steps) {
    if (seen.has(s.order)) throw new AppError(400, `Duplicate step order ${s.order}`);
    seen.add(s.order);
    if (s.approverType === 'USER' && !s.approverUserId) {
      throw new AppError(400, `Step "${s.name}" is set to a specific user but no user was chosen`);
    }
    if (s.approverType === 'ROLE' && !s.approverRoleKey) {
      throw new AppError(400, `Step "${s.name}" is set to a role but no role was chosen`);
    }
    if (s.approverType === 'DYNAMIC_FIELD' && !s.approverField) {
      throw new AppError(400, `Step "${s.name}" is set to a dynamic field but no field was named`);
    }
  }
}

export async function updatePolicy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.approval.update');
    const orgId = req.user!.orgId;

    const existing = await prisma.approvalPolicy.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Approval policy not found');

    const { steps, ...policy } = PolicySchema.partial().parse(req.body);

    if (steps) {
      validateSteps(steps as z.infer<typeof StepSchema>[]);
      // Steps are replaced wholesale. In-flight requests are unaffected
      // because their steps were copied onto ApprovalRequestStep at creation
      // time — editing a policy never rewrites history.
      await prisma.approvalPolicyStep.deleteMany({ where: { policyId: existing.id } });
      await prisma.approvalPolicyStep.createMany({
        data: (steps as z.infer<typeof StepSchema>[]).map(s => ({
          policyId: existing.id,
          order: s.order,
          name: s.name,
          approverType: s.approverType,
          approverUserId: s.approverUserId ?? null,
          approverRoleKey: s.approverRoleKey ?? null,
          approverField: s.approverField ?? null,
          minApprovals: s.minApprovals ?? 1,
          isOptional: s.isOptional ?? false,
          conditions: (s.conditions as any) ?? undefined,
        })),
      });
    }

    const updated = await prisma.approvalPolicy.update({
      where: { id: existing.id },
      data: { ...policy, conditions: (policy.conditions as any) ?? undefined },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    logAction(req.user!.id, 'UPDATE', 'APPROVAL_POLICY', updated.id, {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deletePolicy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.approval.delete');
    const existing = await prisma.approvalPolicy.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!existing) throw new AppError(404, 'Approval policy not found');

    const pending = await prisma.approvalRequest.count({ where: { policyId: existing.id, status: 'PENDING' } });
    if (pending > 0) {
      throw new AppError(400, `${pending} request(s) are still pending under this policy. Deactivate it instead.`);
    }

    await prisma.approvalPolicy.delete({ where: { id: existing.id } });
    res.json({ message: 'Approval policy deleted' });
  } catch (err) {
    next(err);
  }
}

// ═══ Requests ════════════════════════════════════════════════════════════════

const requestInclude = {
  requester: { select: { id: true, name: true, email: true } },
  policy: { select: { id: true, name: true, mode: true } },
  steps: {
    orderBy: { order: 'asc' as const },
    include: { actions: { include: { approver: { select: { id: true, name: true } } } } },
  },
};

export async function listRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.approval.read');
    const orgId = req.user!.orgId;
    const { status, entityType, requestedBy } = req.query as Record<string, string>;

    const where: any = { orgId, ...scopedWhere(ctx, 'approval', 'core.approval.read') };
    if (status) where.status = { in: status.split(',') };
    if (entityType) where.entityType = entityType;
    if (requestedBy) where.requestedBy = requestedBy;

    const pag = parsePagination(req);
    const [rows, total] = await Promise.all([
      prisma.approvalRequest.findMany({
        where,
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        take: pag.limit,
        skip: pag.skip,
      }),
      prisma.approvalRequest.count({ where }),
    ]);

    res.json(paginate(rows, total, pag));
  } catch (err) {
    next(err);
  }
}

/** The caller's approval inbox — everything currently waiting on them. */
export async function myPending(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = await pendingForUser(req.user!.orgId, req.user!.id);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function getRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.approval.read');
    const request = await prisma.approvalRequest.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: requestInclude,
    });
    if (!request) throw new AppError(404, 'Approval request not found');

    // Visible to the requester, any listed approver, or anyone with ALL scope.
    const isApprover = request.steps.some(s => s.approverIds.includes(req.user!.id));
    const isRequester = request.requestedBy === req.user!.id;
    const hasBroadScope = Object.keys(scopedWhere(ctx, 'approval', 'core.approval.read')).length === 0;
    if (!isApprover && !isRequester && !hasBroadScope) throw new AppError(403, 'Insufficient permissions');

    res.json({ ...request, canAct: isApprover && request.status === 'PENDING' });
  } catch (err) {
    next(err);
  }
}

const CreateRequestSchema = z.object({
  entityType: z.enum(APPROVAL_ENTITY_TYPES),
  entityId: z.string().min(1),
  title: z.string().min(1).max(250),
  description: z.string().optional().nullable(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  facts: z.record(z.any()).optional(),
});

export async function createRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.approval.create');
    const data = CreateRequestSchema.parse(req.body);

    const result = await requestApproval({
      orgId: req.user!.orgId,
      requestedBy: req.user!.id,
      entityType: data.entityType,
      entityId: data.entityId,
      title: data.title,
      description: data.description ?? undefined,
      amount: data.amount,
      currency: data.currency,
      facts: data.facts,
    });

    if (result.autoApproved) {
      res.status(200).json({
        autoApproved: true,
        reason: result.reason,
        message: 'No approval policy applies — this record does not need approval.',
      });
      return;
    }

    res.status(201).json(result.request);
  } catch (err) {
    next(err);
  }
}

const DecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(2000).optional(),
});

export async function decideRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = DecideSchema.parse(req.body);
    const result = await decide({
      orgId: req.user!.orgId,
      requestId: req.params.id,
      userId: req.user!.id,
      decision: data.decision,
      comment: data.comment,
    });

    logAction(req.user!.id, 'UPDATE', 'APPROVAL_REQUEST', req.params.id, {
      decision: data.decision,
      finalized: result.finalized,
    });

    /* Automation hook — fires only when the request reaches a final state
       (a mid-chain single approval isn't a decision yet). Entity carries the
       final status + decision fields for conditions like `status eq REJECTED`. */
    if (result.finalized) {
      const full = await prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
      if (full) {
        runWorkflows({
          trigger: 'APPROVAL_DECIDED', orgId: req.user!.orgId, entityType: 'APPROVAL', entityId: full.id,
          entity: { ...(full as any), decision: data.decision },
        }).catch(() => {});
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function cancelRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const request = await prisma.approvalRequest.findFirst({ where: { id: req.params.id, orgId } });
    if (!request) throw new AppError(404, 'Approval request not found');
    if (request.requestedBy !== req.user!.id) {
      const ctx = await getPermCtx(req.user!);
      assertCan(ctx, 'core.approval.delete');
    }
    if (request.status !== 'PENDING') throw new AppError(400, `This request is already ${request.status.toLowerCase()}`);

    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    res.json({ message: 'Approval request cancelled' });
  } catch (err) {
    next(err);
  }
}

// ═══ Delegations ═════════════════════════════════════════════════════════════

const DelegationSchema = z.object({
  toUserId: z.string().min(1),
  startsAt: z.string(),
  endsAt: z.string(),
  reason: z.string().optional().nullable(),
});

export async function listDelegations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = await prisma.approvalDelegation.findMany({
      where: { orgId: req.user!.orgId, OR: [{ fromUserId: req.user!.id }, { toUserId: req.user!.id }] },
      include: {
        from: { select: { id: true, name: true } },
        to: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: 'desc' },
    });
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function createDelegation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = DelegationSchema.parse(req.body);

    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);
    if (endsAt <= startsAt) throw new AppError(400, 'The end date must be after the start date');
    if (data.toUserId === req.user!.id) throw new AppError(400, 'You cannot delegate approvals to yourself');

    const target = await prisma.user.findFirst({ where: { id: data.toUserId, orgId, isActive: true } });
    if (!target) throw new AppError(404, 'That user was not found in this organization');

    const row = await prisma.approvalDelegation.create({
      data: {
        orgId,
        fromUserId: req.user!.id,
        toUserId: data.toUserId,
        startsAt,
        endsAt,
        reason: data.reason ?? null,
      },
      include: { to: { select: { id: true, name: true } } },
    });

    logAction(req.user!.id, 'CREATE', 'APPROVAL_DELEGATION', row.id, { toUserId: data.toUserId });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function revokeDelegation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const row = await prisma.approvalDelegation.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId, fromUserId: req.user!.id },
    });
    if (!row) throw new AppError(404, 'Delegation not found');
    await prisma.approvalDelegation.update({ where: { id: row.id }, data: { isActive: false } });
    res.json({ message: 'Delegation revoked' });
  } catch (err) {
    next(err);
  }
}
