import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * Tasks, approvals and permissions — the three cross-module primitives.
 *
 * Grouped in one file because the screens that use them use them together:
 * "My Work" shows tasks and pending approvals side by side, and both are
 * filtered by the caller's effective permissions.
 */

// ─── Tasks ────────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  doneAt?: string | null;
  doneBy?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  startAt?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  assigneeUserId?: string | null;
  assigneeEmployeeId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  parentTaskId?: string | null;
  checklist?: ChecklistItem[] | null;
  recurrenceRule?: string | null;
  estimateMinutes?: number | null;
  source: string;
  tags: string[];
  createdAt: string;
  assigneeUser?: { id: string; name: string; email: string; avatarUrl?: string | null } | null;
  assigneeEmployee?: { id: string; displayName: string; employeeCode: string } | null;
  creator?: { id: string; name: string } | null;
  subtasks?: Array<{ id: string; title: string; status: string }>;
  dependsOn?: Array<{ dependsOn: { id: string; title: string; status: string } }>;
}

export interface PendingApproval {
  requestId: string;
  stepId: string;
  stepName: string;
  title: string;
  description?: string | null;
  entityType: string;
  entityId: string;
  amount?: number | null;
  currency?: string | null;
  requester: { id: string; name: string; email: string };
  policyName?: string | null;
  createdAt: string;
  expiresAt?: string | null;
}

export interface MyWork {
  overdue: Task[];
  today: Task[];
  thisWeek: Task[];
  later: Task[];
  noDate: Task[];
  approvals: PendingApproval[];
  counts: {
    overdue: number;
    today: number;
    thisWeek: number;
    approvals: number;
    byStatus: Array<{ status: string; count: number }>;
  };
}

interface Paged<T> {
  data: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export const useMyWork = () =>
  useQuery<MyWork>({
    queryKey: ['my-work'],
    queryFn: () => api.get('/tasks/my-work').then(r => r.data),
    // Short stale time: this is the page people leave open all day and expect
    // to reflect a colleague reassigning something to them.
    staleTime: 30_000,
  });

export const useTasks = (params: Record<string, string | undefined> = {}) =>
  useQuery<Paged<Task>>({
    queryKey: ['tasks', params],
    queryFn: () => api.get('/tasks', { params }).then(r => r.data),
  });

export const useTaskStats = () =>
  useQuery<{
    byStatus: Array<{ status: string; count: number }>;
    byPriority: Array<{ priority: string; count: number }>;
    overdue: number;
    dueToday: number;
  }>({
    queryKey: ['task-stats'],
    queryFn: () => api.get('/tasks/stats').then(r => r.data),
  });

function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['my-work'] });
  qc.invalidateQueries({ queryKey: ['task-stats'] });
}

export const useCreateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Task> & { title: string }) => api.post('/tasks', body).then(r => r.data as Task),
    onSuccess: () => invalidateTasks(qc),
  });
};

export const useUpdateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Task> & { id: string }) =>
      api.patch(`/tasks/${id}`, body).then(r => r.data as Task),
    onSuccess: () => invalidateTasks(qc),
  });
};

export const useDeleteTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`).then(r => r.data),
    onSuccess: () => invalidateTasks(qc),
  });
};

export const useBulkUpdateTasks = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[]; status?: string; priority?: string; assigneeUserId?: string | null }) =>
      api.post('/tasks/bulk', body).then(r => r.data as { updated: number; requested: number }),
    onSuccess: () => invalidateTasks(qc),
  });
};

export const useToggleChecklistItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, done }: { id: string; itemId: string; done: boolean }) =>
      api.patch(`/tasks/${id}/checklist`, { itemId, done }).then(r => r.data as Task),
    onSuccess: () => invalidateTasks(qc),
  });
};

// ─── Approvals ────────────────────────────────────────────────────────────────

export interface ApprovalStep {
  id: string;
  order: number;
  name: string;
  status: string;
  minApprovals: number;
  approverIds: string[];
  isOptional: boolean;
  decidedAt?: string | null;
  actions: Array<{
    id: string;
    decision: string;
    comment?: string | null;
    actedAt: string;
    approver: { id: string; name: string };
  }>;
}

export interface ApprovalRequest {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  description?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  status: string;
  currentStep: number;
  createdAt: string;
  decidedAt?: string | null;
  expiresAt?: string | null;
  requester: { id: string; name: string; email: string };
  policy?: { id: string; name: string; mode: string } | null;
  steps: ApprovalStep[];
  canAct?: boolean;
}

export interface ApprovalPolicyStep {
  id?: string;
  order: number;
  name: string;
  approverType: string;
  approverUserId?: string | null;
  approverRoleKey?: string | null;
  approverField?: string | null;
  minApprovals?: number;
  isOptional?: boolean;
  conditions?: Array<{ field: string; op: string; value: unknown }> | null;
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  description?: string | null;
  entityType: string;
  mode: string;
  conditions?: Array<{ field: string; op: string; value: unknown }> | null;
  priority: number;
  expiryHours?: number | null;
  escalateAfterHours?: number | null;
  isActive: boolean;
  steps: ApprovalPolicyStep[];
  _count?: { requests: number };
}

/** GET /approvals/policies is MANAGERS-only — callers pass `can.readApprovalPolicies(role)`.
 *  The rest of the approvals surface (inbox, requests, delegations) is open to
 *  everyone, so only this one query needs the gate. */
export const useApprovalPolicies = (enabled = true) =>
  useQuery<{ data: ApprovalPolicy[]; total: number }>({
    queryKey: ['approval-policies'],
    queryFn: () => api.get('/approvals/policies').then(r => r.data),
    enabled,
  });

export const useApprovalRequests = (params: Record<string, string | undefined> = {}) =>
  useQuery<Paged<ApprovalRequest>>({
    queryKey: ['approval-requests', params],
    queryFn: () => api.get('/approvals/requests', { params }).then(r => r.data),
  });

export const useMyPendingApprovals = () =>
  useQuery<{ data: PendingApproval[]; total: number }>({
    queryKey: ['my-approvals'],
    queryFn: () => api.get('/approvals/requests/my-pending').then(r => r.data),
  });

export const useApprovalRequest = (id?: string) =>
  useQuery<ApprovalRequest>({
    queryKey: ['approval-request', id],
    queryFn: () => api.get(`/approvals/requests/${id}`).then(r => r.data),
    enabled: !!id,
  });

function invalidateApprovals(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['approval-requests'] });
  qc.invalidateQueries({ queryKey: ['my-approvals'] });
  qc.invalidateQueries({ queryKey: ['approval-request'] });
  qc.invalidateQueries({ queryKey: ['my-work'] });
  // A decision writes back to the source record (leave, change request,
  // quote), so those lists are stale too.
  qc.invalidateQueries({ queryKey: ['leave-requests'] });
  qc.invalidateQueries({ queryKey: ['change-requests'] });
  qc.invalidateQueries({ queryKey: ['quotes'] });
}

export const useDecideApproval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: 'APPROVED' | 'REJECTED'; comment?: string }) =>
      api.post(`/approvals/requests/${id}/decide`, { decision, comment }).then(r => r.data),
    onSuccess: () => invalidateApprovals(qc),
  });
};

export const useCancelApproval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/approvals/requests/${id}/cancel`).then(r => r.data),
    onSuccess: () => invalidateApprovals(qc),
  });
};

export const useCreateApprovalPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ApprovalPolicy> & { name: string; entityType: string; steps: ApprovalPolicyStep[] }) =>
      api.post('/approvals/policies', body).then(r => r.data as ApprovalPolicy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-policies'] }),
  });
};

export const useUpdateApprovalPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<ApprovalPolicy> & { id: string }) =>
      api.patch(`/approvals/policies/${id}`, body).then(r => r.data as ApprovalPolicy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-policies'] }),
  });
};

export const useDeleteApprovalPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/approvals/policies/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-policies'] }),
  });
};

export interface Delegation {
  id: string;
  fromUserId: string;
  toUserId: string;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
  isActive: boolean;
  from?: { id: string; name: string };
  to?: { id: string; name: string };
}

export const useDelegations = () =>
  useQuery<{ data: Delegation[]; total: number }>({
    queryKey: ['delegations'],
    queryFn: () => api.get('/approvals/delegations').then(r => r.data),
  });

export const useCreateDelegation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { toUserId: string; startsAt: string; endsAt: string; reason?: string }) =>
      api.post('/approvals/delegations', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delegations'] }),
  });
};

export const useRevokeDelegation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/approvals/delegations/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delegations'] }),
  });
};

// ─── Permissions ──────────────────────────────────────────────────────────────

export type PermScope = 'NONE' | 'OWN' | 'TEAM' | 'DEPARTMENT' | 'ALL';
export type FieldAccess = 'HIDDEN' | 'MASKED' | 'READ' | 'WRITE';

export interface Role {
  id: string;
  orgId: string | null;
  key: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  legacyRole?: string | null;
  rank: number;
  isActive: boolean;
  permissions: Array<{ permissionKey: string; scope: PermScope }>;
  fieldPermissions: Array<{ id: string; resource: string; field: string; access: FieldAccess }>;
  _count?: { users: number };
}

export interface PermissionCatalogEntry {
  key: string;
  resource: string;
  action: string;
  label: string;
  isSensitive: boolean;
  scopable: boolean;
}

export interface MyPermissions {
  role: string;
  roleKey: string;
  roleId: string | null;
  employeeId: string | null;
  departmentId: string | null;
  directReports: number;
  permissions: Record<string, PermScope>;
  fieldRules: Record<string, FieldAccess>;
}

/**
 * The caller's effective permissions.
 *
 * Cached generously: the server caches the same computation for 60s anyway,
 * and re-fetching it on every navigation would add a round trip to every page
 * load for data that changes when an admin edits a role — i.e. rarely.
 */
export const useMyPermissions = () =>
  useQuery<MyPermissions>({
    queryKey: ['my-permissions'],
    queryFn: () => api.get('/permissions/me').then(r => r.data),
    staleTime: 5 * 60_000,
  });

/** Convenience: does the current user hold this permission at any scope? */
export function useCan(permissionKey: string): boolean {
  const { data } = useMyPermissions();
  const scope = data?.permissions?.[permissionKey];
  return !!scope && scope !== 'NONE';
}

/* /permissions/roles and /permissions/catalog are MANAGERS-only. `/permissions/me`
   above is deliberately *not* gated — every role is allowed to read its own
   permissions. Callers of these two pass `can.readRoles(role)`. */
export const useRoles = (enabled = true) =>
  useQuery<{ data: Role[]; total: number }>({
    queryKey: ['roles'],
    queryFn: () => api.get('/permissions/roles').then(r => r.data),
    enabled,
  });

export const usePermissionCatalog = (enabled = true) =>
  useQuery<{ data: Record<string, PermissionCatalogEntry[]>; scopes: PermScope[] }>({
    queryKey: ['permission-catalog'],
    queryFn: () => api.get('/permissions/catalog').then(r => r.data),
    enabled,
  });

function invalidateRoles(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['roles'] });
  qc.invalidateQueries({ queryKey: ['my-permissions'] });
}

export const useCreateRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { key: string; name: string; description?: string; rank?: number; permissions?: Array<{ permissionKey: string; scope: PermScope }> }) =>
      api.post('/permissions/roles', body).then(r => r.data as Role),
    onSuccess: () => invalidateRoles(qc),
  });
};

export const useUpdateRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Role> & { permissions?: Array<{ permissionKey: string; scope: PermScope }> }) =>
      api.patch(`/permissions/roles/${id}`, body).then(r => r.data as Role),
    onSuccess: () => invalidateRoles(qc),
  });
};

export const useDeleteRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/permissions/roles/${id}`).then(r => r.data),
    onSuccess: () => invalidateRoles(qc),
  });
};

export const useSetFieldPermission = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, resource, field, access }: { roleId: string; resource: string; field: string; access: FieldAccess }) =>
      api.post(`/permissions/roles/${roleId}/fields`, { resource, field, access }).then(r => r.data),
    onSuccess: () => invalidateRoles(qc),
  });
};

export const useDeleteFieldPermission = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, fieldPermissionId }: { roleId: string; fieldPermissionId: string }) =>
      api.delete(`/permissions/roles/${roleId}/fields/${fieldPermissionId}`).then(r => r.data),
    onSuccess: () => invalidateRoles(qc),
  });
};

export const useAssignRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string | null }) =>
      api.post('/permissions/assign', { userId, roleId }).then(r => r.data),
    onSuccess: () => {
      invalidateRoles(qc);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
};

// ─── Knowledge / AI governance ────────────────────────────────────────────────

export interface KnowledgeHit {
  chunkId: string;
  documentId: string;
  title: string;
  heading: string | null;
  content: string;
  url: string | null;
  entityType: string | null;
  entityId: string | null;
  score: number;
}

export interface RagAnswer {
  answer: string;
  citations: Array<{ documentId: string; title: string; heading: string | null; url: string | null; score: number }>;
  confidence: number;
  logId: string | null;
  noContext: boolean;
}

export const useKnowledgeAsk = () =>
  useMutation({
    mutationFn: (query: string) => api.post('/knowledge/ask', { query }).then(r => r.data as RagAnswer),
  });

export const useKnowledgeSearch = () =>
  useMutation({
    mutationFn: (query: string) =>
      api.post('/knowledge/search', { query }).then(r => r.data as { data: KnowledgeHit[]; total: number; vectorBackend: string }),
  });

/* The /knowledge/* reads below are MANAGERS-only — callers pass `can.readAiConfig(role)`. */
export const useKnowledgeStats = (enabled = true) =>
  useQuery<{
    documents: number;
    chunks: number;
    lastIndexedAt: string | null;
    vectorBackend: string;
    byVisibility: Array<{ visibility: string; count: number }>;
    byType: Array<{ entityType: string; count: number }>;
  }>({
    queryKey: ['knowledge-stats'],
    queryFn: () => api.get('/knowledge/stats').then(r => r.data),
    enabled,
  });

export const useReindexKnowledge = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post('/knowledge/reindex').then(r => r.data as { indexed: number; skipped: number; costUsd: number; message: string; vectorBackend: string }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-stats'] }),
  });
};

export const useAiFeedback = () =>
  useMutation({
    mutationFn: ({ logId, feedback, reason }: { logId: string; feedback: 'UP' | 'DOWN'; reason?: string }) =>
      api.post(`/knowledge/feedback/${logId}`, { feedback, reason }).then(r => r.data),
  });

export interface AiObservability {
  totalCalls: number;
  successRate: number;
  errorCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  actionsExecuted: number;
  feedbackUp: number;
  feedbackDown: number;
  byFeature: Array<{ feature: string; calls: number; costUsd: number; tokens: number }>;
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
  budget: { allowed: boolean; hardStop: boolean; limitUsd: number; spendUsd: number; percentUsed: number };
}

export const useAiObservability = (days = 30, enabled = true) =>
  useQuery<AiObservability>({
    queryKey: ['ai-observability', days],
    queryFn: () => api.get('/knowledge/ai/observability', { params: { days } }).then(r => r.data),
    enabled,
  });

export const useAiLogs = (params: Record<string, string | undefined> = {}, enabled = true) =>
  useQuery<Paged<{
    id: string;
    feature: string;
    taskType: string;
    providerKey: string;
    model: string;
    totalTokens: number;
    costUsd: string | number;
    latencyMs: number;
    status: string;
    errorMessage?: string | null;
    actionName?: string | null;
    actionExecuted: boolean;
    redactedFields: string[];
    feedback?: string | null;
    createdAt: string;
    user?: { id: string; name: string; email: string } | null;
  }>>({
    queryKey: ['ai-logs', params],
    queryFn: () => api.get('/knowledge/ai/logs', { params }).then(r => r.data),
    enabled,
  });

export const useSetAiBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { limitUsd: number; alertThresholdPercent?: number; hardStop?: boolean }) =>
      api.put('/knowledge/ai/budget', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-observability'] }),
  });
};
