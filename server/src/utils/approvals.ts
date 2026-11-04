/**
 * Approval engine — one implementation reused by leave, change requests,
 * quotes, expenses, service requests and anything added later.
 *
 * ── Why one engine ────────────────────────────────────────────────────────
 * Before this, every module invented its own approval: LeaveRequest had
 * decidedBy/decidedAt, ChangeRequest had approvedBy/rejectedBy/rejectionReason,
 * Quote had a status string and nothing else. Three approval concepts, none of
 * them supporting a second approver, an amount threshold, a delegation, or an
 * escalation — and a fourth would have been invented for expenses.
 *
 * ── Compatibility ─────────────────────────────────────────────────────────
 * The legacy columns are NOT removed. When a request reaches a terminal state
 * this engine writes back to whichever source-record columns already existed
 * (see applyDecisionToSource), so every screen, report and e2e spec that reads
 * LeaveRequest.status keeps working unchanged. A module adopts the engine by
 * calling requestApproval() in addition to what it already does — never
 * instead of it — which is what makes this landable without a big-bang
 * migration of the HR module.
 */
import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';
import { createNotification } from '../modules/notifications/notifications.controller';

// ─── Condition evaluation ─────────────────────────────────────────────────────
//
// Same operator vocabulary as utils/workflow-engine.ts on purpose: an admin
// who has learned conditions in the workflow builder should not have to learn
// a second dialect here.

export type ConditionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

export interface Condition {
  field: string;
  op: ConditionOp;
  value: unknown;
}

export type Facts = Record<string, unknown>;

export function evaluateCondition(fact: unknown, op: ConditionOp, value: unknown): boolean {
  switch (op) {
    case 'eq':
      return String(fact) === String(value);
    case 'neq':
      return String(fact) !== String(value);
    case 'gt':
      return Number(fact) > Number(value);
    case 'gte':
      return Number(fact) >= Number(value);
    case 'lt':
      return Number(fact) < Number(value);
    case 'lte':
      return Number(fact) <= Number(value);
    case 'contains':
      return String(fact ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'in':
      return Array.isArray(value) && value.map(String).includes(String(fact));
    default:
      return false;
  }
}

export function conditionsMatch(conditions: unknown, facts: Facts): boolean {
  if (!conditions) return true;
  const list = Array.isArray(conditions) ? (conditions as Condition[]) : [];
  if (!list.length) return true;
  return list.every(c => evaluateCondition(facts[c.field], c.op, c.value));
}

// ─── Approver resolution ──────────────────────────────────────────────────────

/**
 * Turns an abstract approver type into concrete user ids, at request-creation
 * time.
 *
 * These ids are then frozen onto ApprovalRequestStep.approverIds. That's
 * deliberate: if we resolved MANAGER lazily at decision time, a reorg midway
 * through an approval would silently change who was allowed to approve it, and
 * the audit trail would be unable to answer "who was supposed to sign this?"
 * six months later.
 */
async function resolveApprovers(
  step: {
    approverType: string;
    approverUserId: string | null;
    approverRoleKey: string | null;
    approverField: string | null;
  },
  ctx: { orgId: string; requesterUserId: string; facts: Facts }
): Promise<string[]> {
  const { orgId, requesterUserId, facts } = ctx;

  switch (step.approverType) {
    case 'USER':
      return step.approverUserId ? [step.approverUserId] : [];

    case 'ROLE': {
      if (!step.approverRoleKey) return [];
      const byRole = await prisma.user.findMany({
        where: { orgId, isActive: true, roleRef: { key: step.approverRoleKey } },
        select: { id: true },
      });
      if (byRole.length) return byRole.map(u => u.id);
      // Fall back to the legacy enum so a policy naming SUPER_ADMIN still
      // resolves in an org that hasn't been migrated to Role rows yet.
      const byLegacy = await prisma.user.findMany({
        where: { orgId, isActive: true, role: step.approverRoleKey as any },
        select: { id: true },
      });
      return byLegacy.map(u => u.id);
    }

    case 'MANAGER': {
      const emp = await prisma.employee.findFirst({
        where: { orgId, userId: requesterUserId },
        select: { manager: { select: { userId: true } } },
      });
      return emp?.manager?.userId ? [emp.manager.userId] : [];
    }

    case 'SKIP_LEVEL_MANAGER': {
      const emp = await prisma.employee.findFirst({
        where: { orgId, userId: requesterUserId },
        select: { manager: { select: { manager: { select: { userId: true } } } } },
      });
      const skip = emp?.manager?.manager?.userId;
      return skip ? [skip] : [];
    }

    case 'DEPARTMENT_HEAD': {
      const emp = await prisma.employee.findFirst({
        where: { orgId, userId: requesterUserId },
        select: { department: { select: { head: { select: { userId: true } } } } },
      });
      const head = emp?.department?.head?.userId;
      return head ? [head] : [];
    }

    case 'TEAM_LEAD': {
      const emp = await prisma.employee.findFirst({
        where: { orgId, userId: requesterUserId },
        select: { id: true },
      });
      if (!emp) return [];
      const membership = await prisma.teamMember.findFirst({
        where: { employeeId: emp.id },
        select: { team: { select: { lead: { select: { userId: true } } } } },
      });
      const lead = membership?.team?.lead?.userId;
      return lead ? [lead] : [];
    }

    case 'DYNAMIC_FIELD': {
      const v = step.approverField ? facts[step.approverField] : null;
      return typeof v === 'string' && v ? [v] : [];
    }

    default:
      return [];
  }
}

/**
 * Expands an approver list through any active delegations.
 *
 * Both the original and the delegate can act — removing the original would
 * mean an approver who came back early from leave could no longer sign their
 * own queue.
 */
async function applyDelegations(orgId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return userIds;
  const now = new Date();
  const delegations = await prisma.approvalDelegation.findMany({
    where: {
      orgId,
      isActive: true,
      fromUserId: { in: userIds },
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    select: { toUserId: true },
  });
  return [...new Set([...userIds, ...delegations.map(d => d.toUserId)])];
}

// ─── Creating a request ───────────────────────────────────────────────────────

export interface RequestApprovalInput {
  orgId: string;
  entityType: string;
  entityId: string;
  title: string;
  description?: string;
  requestedBy: string;
  amount?: number;
  currency?: string;
  facts?: Facts;
}

export interface RequestApprovalResult {
  request: { id: string; status: string; currentStep: number } | null;
  /** True when no policy matched — caller should fall back to its own logic. */
  autoApproved: boolean;
  reason?: string;
}

/**
 * Creates an approval for a record, if a policy matches it.
 *
 * Returns `autoApproved: true` when no policy applies. That is the important
 * default: a customer who has configured nothing gets today's behavior (the
 * record proceeds), not a request stuck forever waiting for an approver who
 * was never defined.
 */
export async function requestApproval(input: RequestApprovalInput): Promise<RequestApprovalResult> {
  const facts: Facts = {
    ...input.facts,
    amount: input.amount ?? 0,
    entityType: input.entityType,
    requestedBy: input.requestedBy,
  };

  const policies = await prisma.approvalPolicy.findMany({
    where: { orgId: input.orgId, entityType: input.entityType, isActive: true },
    include: { steps: { orderBy: { order: 'asc' } } },
    orderBy: { priority: 'desc' },
  });

  const policy = policies.find(p => conditionsMatch(p.conditions, facts));
  if (!policy || !policy.steps.length) {
    return { request: null, autoApproved: true, reason: 'No matching approval policy' };
  }

  const expiresAt = policy.expiryHours
    ? new Date(Date.now() + policy.expiryHours * 3_600_000)
    : null;

  const request = await prisma.approvalRequest.create({
    data: {
      orgId: input.orgId,
      policyId: policy.id,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      description: input.description ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      requestedBy: input.requestedBy,
      status: 'PENDING',
      currentStep: 1,
      expiresAt,
      facts: facts as any,
    },
  });

  let order = 1;
  for (const step of policy.steps) {
    if (!conditionsMatch(step.conditions, facts)) continue;

    const resolved = await resolveApprovers(step, {
      orgId: input.orgId,
      requesterUserId: input.requestedBy,
      facts,
    });
    const approverIds = await applyDelegations(input.orgId, resolved);

    await prisma.approvalRequestStep.create({
      data: {
        requestId: request.id,
        order: order++,
        name: step.name,
        status: 'PENDING',
        minApprovals: step.minApprovals,
        approverIds,
        isOptional: step.isOptional,
      },
    });
  }

  const steps = await prisma.approvalRequestStep.findMany({
    where: { requestId: request.id },
    orderBy: { order: 'asc' },
  });

  if (!steps.length) {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });
    return { request: null, autoApproved: true, reason: 'All policy steps were skipped by conditions' };
  }

  // PARALLEL/UNANIMOUS open every step at once; SEQUENTIAL/ANY_ONE walk them.
  if (policy.mode === 'PARALLEL' || policy.mode === 'UNANIMOUS') {
    await notifyStep(input.orgId, request.id, steps.map(s => s.order));
  } else {
    await notifyStep(input.orgId, request.id, [steps[0].order]);
  }

  return { request: { id: request.id, status: 'PENDING', currentStep: 1 }, autoApproved: false };
}

async function notifyStep(orgId: string, requestId: string, orders: number[]): Promise<void> {
  const steps = await prisma.approvalRequestStep.findMany({
    where: { requestId, order: { in: orders } },
    include: { request: { select: { title: true, entityType: true, entityId: true } } },
  });

  for (const step of steps) {
    for (const approverId of step.approverIds) {
      try {
        await createNotification({
          orgId,
          userId: approverId,
          type: 'ASSIGNMENT',
          title: 'Approval needed',
          body: `${step.request.title} — awaiting your approval (${step.name})`,
          entityType: 'APPROVAL_REQUEST',
          entityId: requestId,
        });
      } catch {
        /* notification failure must not block the approval */
      }
    }
  }
}

// ─── Deciding ─────────────────────────────────────────────────────────────────

export interface DecideInput {
  orgId: string;
  requestId: string;
  userId: string;
  decision: 'APPROVED' | 'REJECTED';
  comment?: string;
}

export interface DecideResult {
  status: string;
  currentStep: number;
  finalized: boolean;
}

/**
 * Records one approver's decision and advances the request.
 *
 * A rejection at any step terminates the whole request immediately — there is
 * no configuration where "someone said no" means "keep asking other people",
 * and pretending otherwise produces approvals nobody believes.
 */
export async function decide(input: DecideInput): Promise<DecideResult> {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: input.requestId, orgId: input.orgId },
    include: { steps: { orderBy: { order: 'asc' }, include: { actions: true } }, policy: true },
  });

  if (!request) throw new AppError(404, 'Approval request not found');
  if (request.status !== 'PENDING') throw new AppError(400, `This request is already ${request.status.toLowerCase()}`);
  if (request.expiresAt && request.expiresAt < new Date()) {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'EXPIRED', decidedAt: new Date() },
    });
    throw new AppError(400, 'This approval request has expired');
  }

  const mode = request.policy?.mode ?? 'SEQUENTIAL';
  const openSteps =
    mode === 'PARALLEL' || mode === 'UNANIMOUS'
      ? request.steps.filter(s => s.status === 'PENDING')
      : request.steps.filter(s => s.status === 'PENDING' && s.order === request.currentStep);

  const step = openSteps.find(s => s.approverIds.includes(input.userId));
  if (!step) throw new AppError(403, 'You are not an approver for the current step');
  if (step.actions.some(a => a.approverId === input.userId)) {
    throw new AppError(400, 'You have already acted on this step');
  }

  const delegation = await prisma.approvalDelegation.findFirst({
    where: {
      orgId: input.orgId,
      toUserId: input.userId,
      isActive: true,
      startsAt: { lte: new Date() },
      endsAt: { gte: new Date() },
    },
    select: { fromUserId: true },
  });

  await prisma.approvalAction.create({
    data: {
      stepId: step.id,
      approverId: input.userId,
      delegatedFromUserId: delegation?.fromUserId ?? null,
      decision: input.decision,
      comment: input.comment ?? null,
    },
  });

  if (input.decision === 'REJECTED') {
    await prisma.$transaction([
      prisma.approvalRequestStep.update({
        where: { id: step.id },
        data: { status: 'REJECTED', decidedAt: new Date() },
      }),
      prisma.approvalRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', decidedAt: new Date() },
      }),
    ]);
    await applyDecisionToSource(request.entityType, request.entityId, 'REJECTED', input.userId, input.comment);
    await notifyRequester(request.orgId, request.requestedBy, request.title, 'rejected');
    return { status: 'REJECTED', currentStep: request.currentStep, finalized: true };
  }

  const approvals = step.actions.filter(a => a.decision === 'APPROVED').length + 1;
  if (approvals < step.minApprovals) {
    return { status: 'PENDING', currentStep: request.currentStep, finalized: false };
  }

  await prisma.approvalRequestStep.update({
    where: { id: step.id },
    data: { status: 'APPROVED', decidedAt: new Date() },
  });

  const remaining = request.steps.filter(s => s.id !== step.id && s.status === 'PENDING' && !s.isOptional);

  if (mode === 'ANY_ONE' || !remaining.length) {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });
    await applyDecisionToSource(request.entityType, request.entityId, 'APPROVED', input.userId, input.comment);
    await notifyRequester(request.orgId, request.requestedBy, request.title, 'approved');
    return { status: 'APPROVED', currentStep: request.currentStep, finalized: true };
  }

  if (mode === 'SEQUENTIAL') {
    const next = remaining.sort((a, b) => a.order - b.order)[0];
    await prisma.approvalRequest.update({ where: { id: request.id }, data: { currentStep: next.order } });
    await notifyStep(request.orgId, request.id, [next.order]);
    return { status: 'PENDING', currentStep: next.order, finalized: false };
  }

  return { status: 'PENDING', currentStep: request.currentStep, finalized: false };
}

async function notifyRequester(
  orgId: string,
  userId: string,
  title: string,
  outcome: string
): Promise<void> {
  try {
    await createNotification({
      orgId,
      userId,
      type: 'STATUS_CHANGE',
      title: `Request ${outcome}`,
      body: `${title} was ${outcome}.`,
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * Writes the outcome back onto the module's own columns.
 *
 * This is the compatibility bridge described in the file header. Every branch
 * here targets columns that already existed before the approval engine, so a
 * screen reading LeaveRequest.status sees the same values it always did,
 * whether the decision came through this engine or the module's original
 * endpoint.
 */
async function applyDecisionToSource(
  entityType: string,
  entityId: string,
  decision: 'APPROVED' | 'REJECTED',
  userId: string,
  comment?: string
): Promise<void> {
  try {
    switch (entityType) {
      case 'LEAVE_REQUEST':
        await prisma.leaveRequest.update({
          where: { id: entityId },
          data: {
            status: decision,
            decidedBy: userId,
            decidedAt: new Date(),
            rejectionReason: decision === 'REJECTED' ? comment ?? null : null,
          },
        });
        break;

      case 'CHANGE_REQUEST':
        await prisma.changeRequest.update({
          where: { id: entityId },
          data:
            decision === 'APPROVED'
              ? { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() }
              : { status: 'REJECTED', rejectedBy: userId, rejectionReason: comment ?? null },
        });
        break;

      case 'QUOTE':
        await prisma.quote.update({
          where: { id: entityId },
          data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' },
        });
        break;

      case 'TASK':
        if (decision === 'APPROVED') {
          await prisma.task.update({
            where: { id: entityId },
            data: { status: 'DONE', completedAt: new Date() },
          });
        }
        break;

      default:
        // Unknown entity types are fine — the ApprovalRequest row is itself
        // the record of the decision, and the owning module can read it.
        break;
    }
  } catch (err) {
    console.error(`[approvals] could not write decision back to ${entityType}:${entityId}`, err);
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Everything currently waiting on this user — the "My Approvals" inbox. */
export async function pendingForUser(orgId: string, userId: string) {
  const steps = await prisma.approvalRequestStep.findMany({
    where: {
      status: 'PENDING',
      approverIds: { has: userId },
      request: { orgId, status: 'PENDING' },
    },
    include: {
      request: {
        include: { requester: { select: { id: true, name: true, email: true } }, policy: { select: { name: true, mode: true } } },
      },
      actions: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return steps
    .filter(s => {
      const mode = s.request.policy?.mode ?? 'SEQUENTIAL';
      const isCurrent = mode === 'PARALLEL' || mode === 'UNANIMOUS' || s.order === s.request.currentStep;
      return isCurrent && !s.actions.some(a => a.approverId === userId);
    })
    .map(s => ({
      requestId: s.request.id,
      stepId: s.id,
      stepName: s.name,
      title: s.request.title,
      description: s.request.description,
      entityType: s.request.entityType,
      entityId: s.request.entityId,
      amount: s.request.amount ? Number(s.request.amount) : null,
      currency: s.request.currency,
      requester: s.request.requester,
      policyName: s.request.policy?.name ?? null,
      createdAt: s.request.createdAt,
      expiresAt: s.request.expiresAt,
    }));
}

/**
 * Expires overdue requests. Called by the scheduler alongside the SLA monitor.
 * Batched at 200 so one very stale tenant can't monopolise a tick.
 */
export async function expireOverdueApprovals(): Promise<number> {
  const overdue = await prisma.approvalRequest.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    select: { id: true, orgId: true, requestedBy: true, title: true },
    take: 200,
  });

  for (const r of overdue) {
    await prisma.approvalRequest.update({
      where: { id: r.id },
      data: { status: 'EXPIRED', decidedAt: new Date() },
    });
    await notifyRequester(r.orgId, r.requestedBy, r.title, 'expired without a decision');
  }

  return overdue.length;
}
