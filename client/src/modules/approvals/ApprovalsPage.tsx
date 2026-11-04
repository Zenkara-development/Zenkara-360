import { useState } from 'react';
import {
  useApprovalRequests,
  useMyPendingApprovals,
  useApprovalPolicies,
  useCreateApprovalPolicy,
  useDeleteApprovalPolicy,
  useDecideApproval,
  useCancelApproval,
  useDelegations,
  useCreateDelegation,
  useRevokeDelegation,
  type ApprovalPolicyStep,
} from '../../api/work';
import { useRoles } from '../../api/work';
import {
  PageHeader, PageBody, Toolbar, Card, Tabs, Button, IconButton, Modal, Badge,
  Field, Input, Select, FormError, EmptyState, SkeletonCard, approvalStatusVariant,
  type TabItem,
} from '../../shared/components';
import { CheckCircle2, Plus, Trash2, UserCheck, Inbox, GitBranch, Check, X } from 'lucide-react';
import { useFormat } from '../../hooks/useFormat';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../shared/permissions';

/**
 * Approvals (§46) — one engine for leave, changes, quotes, expenses and
 * anything else a customer wires up.
 *
 * Three views, because approvals have three audiences: the person who has to
 * decide (Inbox), the person who wants to know where their request got to
 * (All requests), and the admin who defines the rules (Policies).
 */

/** `approvalStatusVariant` covers the request states; steps add SKIPPED. */
const stepVariant = (status: string) => approvalStatusVariant[status] ?? 'gray';

const ENTITY_TYPES = [
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
];

const APPROVER_TYPES = [
  { value: 'MANAGER', label: "Requester's manager" },
  { value: 'SKIP_LEVEL_MANAGER', label: "Manager's manager" },
  { value: 'DEPARTMENT_HEAD', label: 'Head of department' },
  { value: 'TEAM_LEAD', label: 'Team lead' },
  { value: 'ROLE', label: 'Anyone with a role' },
  { value: 'USER', label: 'A specific person' },
];

// ─── Inbox ────────────────────────────────────────────────────────────────────

function InboxPanel() {
  const { data, isLoading } = useMyPendingApprovals();
  const decide = useDecideApproval();
  const fmt = useFormat();
  const [comments, setComments] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // `decide` is one mutation shared across every row, so `decide.isPending`
  // cannot say WHICH row is busy. Without this, acting on one approval spun
  // and disabled the buttons on all of them.
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        <SkeletonCard lines={3} /><SkeletonCard lines={3} />
      </div>
    );
  }
  if (!data?.data.length) {
    return (
      <EmptyState
        icon={<Inbox />}
        title="Nothing waiting on you"
        description="When someone raises a request that needs your approval, it lands here."
      />
    );
  }

  const act = (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setErrors(e => ({ ...e, [id]: '' }));
    setPendingId(id);
    decide.mutate(
      { id, decision, comment: comments[id] || undefined },
      {
        onError: (err: any) =>
          setErrors(e => ({ ...e, [id]: err?.response?.data?.error || 'Could not record that decision.' })),
        onSettled: () => setPendingId(null),
      }
    );
  };

  return (
    <div className="space-y-2">
      {data.data.map(a => (
        <Card key={a.stepId} padding="sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-fg">{a.title}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant="yellow">{a.stepName}</Badge>
                <Badge variant="gray">{a.entityType.replace(/_/g, ' ').toLowerCase()}</Badge>
                <span className="text-[11.5px] text-fg-subtle">from {a.requester.name}</span>
                {a.amount != null && (
                  <span className="text-[11.5px] font-medium text-fg tabular-nums">
                    {fmt.money(a.amount)}
                  </span>
                )}
                {a.policyName && <span className="text-[11.5px] text-fg-subtle">· {a.policyName}</span>}
              </div>
              {a.description && (
                <p className="text-[12.5px] text-fg-muted mt-2">{a.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="xs" variant="danger" icon={<X size={12} />} onClick={() => act(a.requestId, 'REJECTED')} loading={pendingId === a.requestId} disabled={!!pendingId}>
                Reject
              </Button>
              <Button size="xs" icon={<Check size={12} />} onClick={() => act(a.requestId, 'APPROVED')} loading={pendingId === a.requestId} disabled={!!pendingId}>
                Approve
              </Button>
            </div>
          </div>

          <Input
            className="mt-3"
            value={comments[a.requestId] ?? ''}
            onChange={e => setComments(c => ({ ...c, [a.requestId]: e.target.value }))}
            aria-label="Optional comment"
            placeholder="Optional comment — the requester will see this"
          />
          {errors[a.requestId] && <FormError className="mt-1.5">{errors[a.requestId]}</FormError>}
          {a.expiresAt && (
            <p className="text-[11px] text-warning mt-1.5">
              Expires {fmt.dateTime(a.expiresAt)} if no decision is made
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─── All requests ─────────────────────────────────────────────────────────────

function RequestsPanel() {
  const [status, setStatus] = useState('');
  const { data, isLoading } = useApprovalRequests({ status: status || undefined });
  const cancel = useCancelApproval();
  const { user } = useAuth();
  const fmt = useFormat();

  return (
    <>
      <Toolbar className="mb-3">
        <Select
          className="w-auto"
          aria-label="Filter by status"
          value={status}
          onChange={e => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Toolbar>

      {isLoading ? (
        <div className="space-y-2" aria-hidden="true">
          <SkeletonCard lines={3} /><SkeletonCard lines={3} /><SkeletonCard lines={3} />
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="No approval requests"
          description="Requests appear here once a module raises one and a matching policy exists."
        />
      ) : (
        <div className="space-y-2">
          {data.data.map(r => (
            <Card key={r.id} padding="sm">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-fg">{r.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant={stepVariant(r.status)}>{r.status}</Badge>
                    <span className="text-[11.5px] text-fg-subtle">{r.requester.name}</span>
                    <span className="text-[11.5px] text-fg-subtle">· {fmt.date(r.createdAt)}</span>
                    {r.policy && <span className="text-[11.5px] text-fg-subtle">· {r.policy.name}</span>}
                  </div>
                </div>
                {r.status === 'PENDING' && r.requester.id === user?.id && (
                  <Button size="xs" variant="secondary" onClick={() => cancel.mutate(r.id)}>
                    Cancel
                  </Button>
                )}
              </div>

              <div className="mt-3 space-y-1.5">
                {r.steps.map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-[12px]">
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                        s.status === 'APPROVED'
                          ? 'bg-success-soft text-success-fg'
                          : s.status === 'REJECTED'
                            ? 'bg-danger-soft text-danger-fg'
                            : 'bg-surface-sunken text-fg-muted'
                      }`}
                    >
                      {s.order}
                    </span>
                    <span className="text-fg">{s.name}</span>
                    <Badge variant={stepVariant(s.status)}>{s.status}</Badge>
                    {s.actions.map(a => (
                      <span key={a.id} className="text-[11px] text-fg-subtle">
                        {a.approver.name} {a.decision.toLowerCase()}
                        {a.comment ? ` — "${a.comment}"` : ''}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Policies ─────────────────────────────────────────────────────────────────

function NewPolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateApprovalPolicy();
  // Role-based approver steps need the MANAGERS-only /permissions/roles list.
  // This modal only ever renders inside the Policies tab, which is itself
  // manager-gated, but the capability travels with the query.
  const { user } = useAuth();
  const { data: roles } = useRoles(can.readRoles(user?.role));
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('LEAVE_REQUEST');
  const [mode, setMode] = useState('SEQUENTIAL');
  const [expiryHours, setExpiryHours] = useState('168');
  const [steps, setSteps] = useState<ApprovalPolicyStep[]>([
    { order: 1, name: 'Manager approval', approverType: 'MANAGER', minApprovals: 1 },
  ]);

  const addStep = () =>
    setSteps(s => [...s, { order: s.length + 1, name: `Step ${s.length + 1}`, approverType: 'MANAGER', minApprovals: 1 }]);

  const updateStep = (i: number, patch: Partial<ApprovalPolicyStep>) =>
    setSteps(s => s.map((step, idx) => (idx === i ? { ...step, ...patch } : step)));

  const removeStep = (i: number) =>
    setSteps(s => s.filter((_, idx) => idx !== i).map((step, idx) => ({ ...step, order: idx + 1 })));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New approval policy"
      subtitle="Rules that decide who signs off on a record, and in what order."
      icon={<GitBranch size={16} />}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!name.trim() || !steps.length}
            onClick={() => {
              setError('');
              create.mutate(
                {
                  name,
                  entityType,
                  mode,
                  expiryHours: expiryHours ? Number(expiryHours) : null,
                  steps,
                },
                {
                  onSuccess: () => {
                    setName('');
                    setSteps([{ order: 1, name: 'Manager approval', approverType: 'MANAGER', minApprovals: 1 }]);
                    onClose();
                  },
                  onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that policy.'),
                }
              );
            }}
          >
            Create policy
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Policy name">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard leave approval" />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Applies to">
            <Select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              options={ENTITY_TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ').toLowerCase() }))}
            />
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={e => setMode(e.target.value)}>
              <option value="SEQUENTIAL">Sequential</option>
              <option value="PARALLEL">Parallel</option>
              <option value="ANY_ONE">Any one</option>
              <option value="UNANIMOUS">Unanimous</option>
            </Select>
          </Field>
          <Field label="Expires after (hours)">
            <Input value={expiryHours} onChange={e => setExpiryHours(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-medium text-fg-muted">Steps</p>
            <Button size="xs" variant="secondary" icon={<Plus size={11} />} onClick={addStep}>
              Add step
            </Button>
          </div>
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={i} className="border border-line rounded-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-surface-sunken text-[10px] font-semibold flex items-center justify-center text-fg-muted shrink-0">
                    {s.order}
                  </span>
                  <div className="flex-1">
                    <Input
                      value={s.name}
                      onChange={e => updateStep(i, { name: e.target.value })}
                      aria-label={`Step ${s.order} name`}
                      placeholder="Step name"
                    />
                  </div>
                  {steps.length > 1 && (
                    <IconButton
                      label="Remove step"
                      icon={<Trash2 size={13} />}
                      tone="danger"
                      onClick={() => removeStep(i)}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    aria-label="Approver type"
                    value={s.approverType}
                    onChange={e => updateStep(i, { approverType: e.target.value })}
                    options={APPROVER_TYPES}
                  />
                  {s.approverType === 'ROLE' && (
                    <Select
                      aria-label="Approver role"
                      value={s.approverRoleKey ?? ''}
                      onChange={e => updateStep(i, { approverRoleKey: e.target.value })}
                    >
                      <option value="">Choose a role…</option>
                      {(roles?.data ?? []).map(r => (
                        <option key={r.id} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}

function PoliciesPanel() {
  const { user } = useAuth();
  const { data, isLoading } = useApprovalPolicies(can.readApprovalPolicies(user?.role));
  const del = useDeleteApprovalPolicy();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[12.5px] text-fg-muted">
          With no matching policy, a record proceeds without approval — so adding one is opt-in, never a surprise block.
        </p>
        <Button size="xs" icon={<Plus size={12} />} onClick={() => setOpen(true)}>
          Policy
        </Button>
      </div>

      {error && <FormError className="mb-2">{error}</FormError>}

      {isLoading ? (
        <div className="space-y-2" aria-hidden="true">
          <SkeletonCard lines={2} /><SkeletonCard lines={2} />
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          icon={<GitBranch />}
          title="No approval policies"
          description="Create one to route leave, changes, quotes or expenses through the right people."
          action={{ label: 'Create policy', onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="space-y-2">
          {data.data.map(p => (
            <Card key={p.id} padding="sm" className="group">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-fg">{p.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="indigo">{p.entityType.replace(/_/g, ' ').toLowerCase()}</Badge>
                    <Badge variant="gray">{p.mode.toLowerCase()}</Badge>
                    {!p.isActive && <Badge variant="gray">Inactive</Badge>}
                    <span className="text-[11.5px] text-fg-subtle tabular-nums">{p._count?.requests ?? 0} requests</span>
                    {p.expiryHours && <span className="text-[11.5px] text-fg-subtle tabular-nums">· expires in {p.expiryHours}h</span>}
                  </div>
                </div>
                <IconButton
                  label="Delete policy"
                  icon={<Trash2 size={13} />}
                  tone="danger"
                  revealOnRowHover
                  onClick={() => {
                    setError('');
                    del.mutate(p.id, {
                      onError: (err: any) => setError(err?.response?.data?.error || 'Could not delete that policy.'),
                    });
                  }}
                />
              </div>

              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {p.steps.map(s => (
                  <Badge key={s.order} variant="gray">
                    {s.order}. {s.name}
                    {s.isOptional && <span className="text-[10px] text-fg-subtle">optional</span>}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewPolicyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ─── Delegations ──────────────────────────────────────────────────────────────

function DelegationsPanel() {
  const { data, isLoading } = useDelegations();
  const create = useCreateDelegation();
  const revoke = useRevokeDelegation();
  const fmt = useFormat();
  const [form, setForm] = useState({ toUserId: '', startsAt: '', endsAt: '', reason: '' });
  const [error, setError] = useState('');

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <p className="text-[13px] font-medium text-fg mb-1">Delegate your approvals</p>
        <p className="text-[12px] text-fg-muted mb-3">
          While a delegation is active, both you and your delegate can approve — so coming back early doesn't lock you
          out of your own queue.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <Input
            aria-label="Delegate's user ID"
            placeholder="Delegate's user ID"
            value={form.toUserId}
            onChange={e => setForm({ ...form, toUserId: e.target.value })}
          />
          <Input
            type="date"
            aria-label="Delegation starts"
            value={form.startsAt}
            onChange={e => setForm({ ...form, startsAt: e.target.value })}
          />
          <Input
            type="date"
            aria-label="Delegation ends"
            value={form.endsAt}
            onChange={e => setForm({ ...form, endsAt: e.target.value })}
          />
          <Button
            size="sm"
            loading={create.isPending}
            disabled={!form.toUserId || !form.startsAt || !form.endsAt}
            onClick={() => {
              setError('');
              create.mutate(
                { toUserId: form.toUserId, startsAt: form.startsAt, endsAt: form.endsAt, reason: form.reason || undefined },
                {
                  onSuccess: () => setForm({ toUserId: '', startsAt: '', endsAt: '', reason: '' }),
                  onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that delegation.'),
                }
              );
            }}
          >
            Delegate
          </Button>
        </div>
        {error && <FormError className="mt-2">{error}</FormError>}
      </Card>

      {isLoading ? (
        <div className="space-y-2" aria-hidden="true">
          <SkeletonCard lines={2} /><SkeletonCard lines={2} />
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          icon={<UserCheck />}
          title="No delegations"
          description="Delegate your approvals when you're away so nothing sits waiting."
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          {data.data.map(d => (
            <div
              key={d.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-line-subtle last:border-0"
            >
              <UserCheck size={14} className="text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-fg">
                  {d.from?.name} → {d.to?.name}
                </p>
                <p className="text-[11px] text-fg-subtle">
                  {fmt.date(d.startsAt)} – {fmt.date(d.endsAt)}
                  {d.reason ? ` · ${d.reason}` : ''}
                </p>
              </div>
              {d.isActive ? (
                <Button size="xs" variant="secondary" onClick={() => revoke.mutate(d.id)}>
                  Revoke
                </Button>
              ) : (
                <Badge variant="gray">Revoked</Badge>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabKey = 'inbox' | 'requests' | 'policies' | 'delegations';

const TABS: TabItem<TabKey>[] = [
  { key: 'inbox', label: 'My inbox', icon: <Inbox size={12} /> },
  { key: 'requests', label: 'All requests', icon: <CheckCircle2 size={12} /> },
  { key: 'policies', label: 'Policies', icon: <GitBranch size={12} /> },
  { key: 'delegations', label: 'Delegations', icon: <UserCheck size={12} /> },
];

export default function ApprovalsPage() {
  const [tab, setTab] = useState<TabKey>('inbox');
  const { data: pending } = useMyPendingApprovals();
  /* Inbox, requests and delegations are everybody's — an employee raising leave
     lives in them. /approvals/policies is MANAGERS-only, so that one tab (and
     only that one) disappears for everyone else rather than opening onto a
     refused list. */
  const { user } = useAuth();
  const showPolicies = can.readApprovalPolicies(user?.role);
  const tabs = TABS.filter(t => t.key !== 'policies' || showPolicies);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Approvals"
        subtitle="One approval engine shared by leave, change requests, quotes and anything else you wire up."
        below={
          <Tabs
            variant="segmented"
            aria-label="Approval views"
            value={tab}
            onChange={setTab}
            items={tabs.map(t => (t.key === 'inbox' ? { ...t, count: pending?.total } : t))}
          />
        }
      />

      <div className="flex-1 overflow-auto">
        <PageBody>
          {tab === 'inbox' && <InboxPanel />}
          {tab === 'requests' && <RequestsPanel />}
          {tab === 'policies' && showPolicies && <PoliciesPanel />}
          {tab === 'delegations' && <DelegationsPanel />}
        </PageBody>
      </div>
    </div>
  );
}
