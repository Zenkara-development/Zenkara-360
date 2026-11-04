import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { GitBranch, Plus, CheckCircle, XCircle, Pencil, Trash2 } from 'lucide-react';
import {
  SearchableSelect, RowActions,
  PageHeader, PageBody, Card, Toolbar, Button, Modal,
  Field, Input, Textarea, Select, Badge, EmptyState, SkeletonCard,
  priorityVariant, RecordTasks, RecordTags} from '../shared/components';
import { Attachments } from '../shared/components/Attachments';
import { useFormat } from '../hooks/useFormat';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChangeRequest {
  id: string;
  title: string;
  description: string;
  type: 'NORMAL' | 'EMERGENCY' | 'STANDARD';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'IMPLEMENTING' | 'DONE';
  requestedBy: string;
  assignedTo?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  requester: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Three local Tailwind colour maps collapsed into Badge variants — the badge
// component owns the light/dark pairs so these only carry the mapping.
const STATUS_VARIANT = {
  DRAFT: 'gray', SUBMITTED: 'blue', APPROVED: 'green',
  REJECTED: 'red', IMPLEMENTING: 'yellow', DONE: 'teal',
} as const;

/* Priority uses the shared semantic map — same hues as tickets and tasks. */
const PRIORITY_VARIANT = priorityVariant;

const TYPE_VARIANT = {
  NORMAL: 'blue', EMERGENCY: 'red', STANDARD: 'gray',
} as const;

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IMPLEMENTING', 'DONE'];

const STATUS_FLOW: Record<string, string[]> = {
  DRAFT:        ['SUBMITTED'],
  SUBMITTED:    [],  // approve/reject separately
  APPROVED:     ['IMPLEMENTING'],
  IMPLEMENTING: ['DONE'],
};

/**
 * The approve / reject / advance chips were three copies of the same markup
 * differing only in which Tailwind colour family they hardcoded. One tinted
 * button, one tone token.
 */
function ActionChip({ tone = 'accent', icon, onClick, children }: {
  tone?: 'accent' | 'success' | 'danger';
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tones = {
    accent:  '',
    success: '!bg-success-soft !text-success-fg',
    danger:  '!bg-danger-soft !text-danger-fg',
  };
  return (
    <Button size="xs" variant="subtle" icon={icon} onClick={onClick} className={tones[tone]}>
      {children}
    </Button>
  );
}

// ─── Form Modal ───────────────────────────────────────────────────────────────

function ChangeRequestModal({ cr, users, onClose }: {
  cr?: ChangeRequest; users: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: cr?.title ?? '',
    description: cr?.description ?? '',
    type: cr?.type ?? 'NORMAL',
    priority: cr?.priority ?? 'MEDIUM',
    assignedTo: cr?.assignedTo ?? '',
    plannedStart: cr?.plannedStart ? cr.plannedStart.split('T')[0] : '',
    plannedEnd: cr?.plannedEnd ? cr.plannedEnd.split('T')[0] : '',
  });

  const save = useMutation({
    mutationFn: (data: any) =>
      cr ? api.patch(`/change-requests/${cr.id}`, data) : api.post('/change-requests', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['change-requests'] }); onClose(); },
  });

  const formId = 'change-request-form';

  return (
    <Modal
      open
      onClose={onClose}
      title={cr ? 'Edit Change Request' : 'New Change Request'}
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {save.isPending ? 'Saving…' : cr ? 'Save Changes' : 'Create Request'}
          </Button>
        </>
      )}
    >
      <form
        id={formId}
        onSubmit={e => { e.preventDefault(); save.mutate({ ...form, assignedTo: form.assignedTo || null, plannedStart: form.plannedStart || null, plannedEnd: form.plannedEnd || null }); }}
        className="space-y-3"
      >
        <div className="form-section">
          <p className="form-section-title">Change Details</p>
          <div className="space-y-4">
            <Field label="Title" required>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required
                aria-label="Title" placeholder="e.g. Upgrade production database to v16" />
            </Field>
            <Field label="Description" required>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required rows={4}
                aria-label="Description" placeholder="Describe the change, impact, and rollback plan…" />
            </Field>
          </div>
        </div>
        <div className="form-section">
          <p className="form-section-title">Classification</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <SearchableSelect ariaLabel="Type" value={form.type} onChange={val => setForm(p => ({ ...p, type: val as any }))} required options={[{value:'STANDARD',label:'Standard'},{value:'NORMAL',label:'Normal'},{value:'EMERGENCY',label:'Emergency'}]} />
            </Field>
            <Field label="Priority">
              <SearchableSelect ariaLabel="Risk Level" value={form.priority} onChange={val => setForm(p => ({ ...p, priority: val as any }))} required options={['LOW','MEDIUM','HIGH','CRITICAL'].map(p => ({ value: p, label: p }))} />
            </Field>
          </div>
        </div>
        <div className="form-section">
          <p className="form-section-title">Schedule &amp; Assignment</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Assigned To" className="col-span-2">
              <SearchableSelect ariaLabel="Assigned To" value={form.assignedTo} onChange={val => setForm(p => ({ ...p, assignedTo: val }))} options={users.map(u => ({ value: u.id, label: u.name }))} placeholder="— Unassigned —" />
            </Field>
            <Field label="Planned Start">
              <Input type="date" value={form.plannedStart} onChange={e => setForm(p => ({ ...p, plannedStart: e.target.value }))} />
            </Field>
            <Field label="Planned End">
              <Input type="date" value={form.plannedEnd} onChange={e => setForm(p => ({ ...p, plannedEnd: e.target.value }))} />
            </Field>
          </div>
        </div>
        {cr && <>
              <RecordTags entityType="CHANGE_REQUEST" entityId={cr.id} />
              <Attachments entityType="CHANGE_REQUEST" entityId={cr.id} />
              <RecordTasks entityType="CHANGE_REQUEST" entityId={cr.id} />
            </>}
      </form>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChangeRequestsPage() {
  const { date } = useFormat();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [modal, setModal] = useState<ChangeRequest | null | 'new'>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/admin/users').then(r => r.data?.data ?? r.data ?? []),
  });

  const params = new URLSearchParams();
  if (filterStatus) params.set('status', filterStatus);
  params.set('limit', '50');

  const { data, isLoading } = useQuery<{ data: ChangeRequest[] }>({
    queryKey: ['change-requests', filterStatus],
    queryFn: () => api.get(`/change-requests?${params}`).then(r => r.data),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/change-requests/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['change-requests'] }),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/change-requests/${id}/reject`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['change-requests'] }); setRejectId(null); setRejectReason(''); },
  });

  const advanceStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/change-requests/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['change-requests'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/change-requests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['change-requests'] }),
  });

  const changeRequests = data?.data ?? [];
  const users = usersData ?? [];

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Change Requests"
        subtitle="Track and approve infrastructure and system changes"
        actions={<Button icon={<Plus size={16} />} onClick={() => setModal('new')}>New Request</Button>}
      />

      <PageBody width="wide">
        {/* Filter */}
        <Toolbar right={<p className="text-sm text-fg-subtle tabular-nums">{changeRequests.length} requests</p>}>
          <Select
            aria-label="Filter by status"
            className="w-44"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Toolbar>

        {isLoading ? (
          <div className="space-y-3" aria-hidden="true">
            <SkeletonCard lines={3} /><SkeletonCard lines={3} /><SkeletonCard lines={3} />
          </div>
        ) : changeRequests.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={<GitBranch size={24} />}
              title="No change requests"
              description={filterStatus
                ? 'No requests match this status filter. Try another status.'
                : 'Track infrastructure and system changes through approval and implementation. Raise your first request.'}
              action={{ label: 'Create First Request', onClick: () => setModal('new') }}
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {changeRequests.map(cr => (
              <Card key={cr.id} data-testid="cr-card">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-fg truncate max-w-full" title={cr.title}>{cr.title}</h3>
                      <Badge variant={STATUS_VARIANT[cr.status]}>{cr.status}</Badge>
                      <Badge variant={TYPE_VARIANT[cr.type]}>{cr.type}</Badge>
                      <Badge variant={PRIORITY_VARIANT[cr.priority]} size="sm">{cr.priority}</Badge>
                    </div>
                    <p className="text-sm text-fg-muted line-clamp-2">{cr.description}</p>
                    <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-xs text-fg-subtle flex-wrap">
                      <span>By {cr.requester.name}</span>
                      {cr.assignee && <span>→ {cr.assignee.name}</span>}
                      {cr.plannedStart && <span className="tabular-nums">Planned: {date(cr.plannedStart)} – {cr.plannedEnd ? date(cr.plannedEnd) : '?'}</span>}
                      <span className="tabular-nums">{date(cr.createdAt)}</span>
                    </div>
                    {cr.status === 'REJECTED' && cr.rejectionReason && (
                      <p className="text-xs text-danger-fg mt-1.5 bg-danger-soft px-3 py-1.5 rounded-btn">Rejected: {cr.rejectionReason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {cr.status === 'SUBMITTED' && (
                      <>
                        <ActionChip tone="success" icon={<CheckCircle size={13} />} onClick={() => approve.mutate(cr.id)}>
                          Approve
                        </ActionChip>
                        <ActionChip tone="danger" icon={<XCircle size={13} />} onClick={() => { setRejectReason(''); setRejectId(cr.id); }}>
                          Reject
                        </ActionChip>
                      </>
                    )}
                    {STATUS_FLOW[cr.status]?.length > 0 && (
                      <ActionChip onClick={() => advanceStatus.mutate({ id: cr.id, status: STATUS_FLOW[cr.status][0] })}>
                        → {STATUS_FLOW[cr.status][0]}
                      </ActionChip>
                    )}
                    <RowActions items={[
                      { label: 'Edit change request', icon: <Pencil size={14} />, onClick: () => setModal(cr), hidden: !['DRAFT','SUBMITTED'].includes(cr.status) },
                      { label: 'Delete change request', icon: <Trash2 size={14} />, onClick: () => { if (confirm('Delete?')) remove.mutate(cr.id); }, variant: 'danger', hidden: cr.status !== 'DRAFT' },
                    ]} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      {/* Reject modal */}
      <Modal
        open={!!rejectId}
        onClose={() => { setRejectId(null); setRejectReason(''); }}
        title="Reject Change Request"
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => { setRejectId(null); setRejectReason(''); }}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!rejectReason}
              loading={reject.isPending}
              onClick={() => rejectId && rejectReason && reject.mutate({ id: rejectId, reason: rejectReason })}
            >
              {reject.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </>
        )}
      >
        <Field label="Reason" required hint="Shared with the requester so they know what to change.">
          <Textarea
            aria-label="Reason for rejection"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            rows={3}
            placeholder="Reason for rejection…"
          />
        </Field>
      </Modal>

      {modal && (
        <ChangeRequestModal
          cr={modal === 'new' ? undefined : modal}
          users={users}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
