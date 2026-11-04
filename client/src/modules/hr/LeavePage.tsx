import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import {
  PageHeader, PageBody, Card, CardHeader, PastelStatCard, type PastelTone, Tabs, Button, Modal, StatusBadge,
  EmptyState, SearchableSelect, Field, Input, Textarea, Select, Checkbox, Alert, SkeletonStats, SkeletonTable,
  approvalStatusVariant, Badge, Avatar,
} from '../../shared/components';
import { CalendarCheck, Plus, X, Check, Clock3, CheckCircle2, Pencil, Ban, SlidersHorizontal, UserPlus, XCircle, CalendarDays, Palmtree } from 'lucide-react';
import { useFormat } from '../../hooks/useFormat';
import { useUsers } from '../../api/users';

const MANAGER_ROLES = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'];

interface LeaveType { id: string; name: string; annualQuota: number; isPaid: boolean; color: string; allowHalfDay?: boolean; isUnlimited?: boolean }
interface Balance { leaveType: LeaveType; quota: number; carriedForward: number; adjustments: number; used: number; remaining: number | null; entitlement: number }
interface LeaveRequest {
  id: string; startDate: string; endDate: string; days: number; reason?: string;
  halfDay?: boolean; halfDayPeriod?: 'AM' | 'PM' | null; cancelReason?: string | null;
  status: string; rejectionReason?: string; createdAt: string;
  leaveType: LeaveType; user: { id: string; name: string; avatarUrl?: string };
  decider?: { name: string } | null;
}

function useBalances(userId?: string, year?: number) {
  return useQuery<Balance[]>({
    queryKey: ['leave-balance', userId ?? 'me', year ?? 'current'],
    queryFn: () => api.get('/hr/leave/balance', { params: { userId, year } }).then(r => r.data),
  });
}

function BalanceCards({ userId, year }: { userId?: string; year?: number }) {
  const { data, isLoading } = useBalances(userId, year);
  if (isLoading) return <SkeletonStats count={4} />;
  return (
    <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-4">
      {(data || []).map((b, i) => (
        <PastelStatCard
          key={b.leaveType.id}
          variant="soft"
          icon={Palmtree}
          tone={BALANCE_TONES[i % BALANCE_TONES.length]}
          label={
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.leaveType.color }} />
              <span className="truncate">{b.leaveType.name}</span>
            </span>
          }
          value={b.leaveType.isUnlimited
            ? <span className="tabular-nums">{b.used}<span className="text-xs font-normal text-fg-subtle"> used · unlimited</span></span>
            : <span className="tabular-nums">{b.remaining}<span className="text-xs font-normal text-fg-subtle"> / {b.entitlement} left{b.carriedForward ? ` (+${b.carriedForward} c/f)` : ''}</span></span>}
        />
      ))}
    </div>
  );
}

const BALANCE_TONES: PastelTone[] = ['blue', 'green', 'orange', 'purple', 'teal', 'pink'];

const fmtDays = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

const EMPTY_APPLY = { leaveTypeId: '', startDate: '', endDate: '', reason: '', halfDay: false, halfDayPeriod: 'AM' as 'AM' | 'PM' };

function ApplyModal({ open, onClose, onBehalfOf }: { open: boolean; onClose: () => void; onBehalfOf?: { id: string; name: string } }) {
  const qc = useQueryClient();
  const { data: types } = useQuery<LeaveType[]>({ queryKey: ['leave-types'], queryFn: () => api.get('/hr/leave/types').then(r => r.data) });
  const [form, setForm] = useState(EMPTY_APPLY);
  const [autoApprove, setAutoApprove] = useState(true);
  const [error, setError] = useState('');
  const selectedType = types?.find(t => t.id === form.leaveTypeId);

  const submit = useMutation({
    mutationFn: () => {
      const body = { ...form, endDate: form.halfDay ? form.startDate : form.endDate, halfDayPeriod: form.halfDay ? form.halfDayPeriod : undefined };
      return onBehalfOf
        ? api.post('/hr/leave/requests/on-behalf', { ...body, userId: onBehalfOf.id, autoApprove }).then(r => r.data)
        : api.post('/hr/leave/requests', body).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['leave-balance'] });
      qc.invalidateQueries({ queryKey: ['attendance-register'] });
      setForm(EMPTY_APPLY);
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not submit request.'),
  });

  return (
    <Modal open={open} onClose={onClose} title={onBehalfOf ? `Apply leave for ${onBehalfOf.name}` : 'Apply for leave'} icon={<CalendarCheck size={16} />}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { setError(''); submit.mutate(); }} loading={submit.isPending} disabled={!form.leaveTypeId || !form.startDate || (!form.halfDay && !form.endDate)}>
          {onBehalfOf ? (autoApprove ? 'Apply & approve' : 'Submit for approval') : 'Submit Request'}
        </Button>
      </>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Leave type">
          <SearchableSelect
            value={form.leaveTypeId}
            onChange={val => setForm(f => ({ ...f, leaveTypeId: val }))}
            options={(types || []).map(t => ({ value: t.id, label: t.name }))}
            required
          />
        </Field>
        {selectedType?.allowHalfDay !== false && (
          <div className="flex items-center gap-4">
            <Checkbox label="Half day" checked={form.halfDay} onChange={e => setForm(f => ({ ...f, halfDay: e.target.checked }))} />
            {form.halfDay && (
              <Select value={form.halfDayPeriod} onChange={e => setForm(f => ({ ...f, halfDayPeriod: e.target.value as 'AM' | 'PM' }))} className="w-40">
                <option value="AM">First half</option><option value="PM">Second half</option>
              </Select>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={form.halfDay ? 'Date' : 'Start date'}>
            <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
          </Field>
          {!form.halfDay && (
            <Field label="End date">
              <Input type="date" value={form.endDate} min={form.startDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} required />
            </Field>
          )}
        </div>
        <Field label="Reason (optional)">
          <Textarea rows={3} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
        </Field>
        {onBehalfOf && <Checkbox label="Approve immediately (skips the manager approval step)" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />}
      </div>
    </Modal>
  );
}

function ModifyModal({ req, onClose }: { req: LeaveRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: types } = useQuery<LeaveType[]>({ queryKey: ['leave-types'], queryFn: () => api.get('/hr/leave/types').then(r => r.data) });
  const [form, setForm] = useState({ leaveTypeId: req.leaveType.id, startDate: req.startDate.slice(0, 10), endDate: req.endDate.slice(0, 10), halfDay: !!req.halfDay, halfDayPeriod: (req.halfDayPeriod || 'AM') as 'AM' | 'PM', reason: req.reason || '', changeReason: '' });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/hr/leave/requests/${req.id}`, { ...form, endDate: form.halfDay ? form.startDate : form.endDate }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leave-requests'] }); qc.invalidateQueries({ queryKey: ['leave-balance'] }); qc.invalidateQueries({ queryKey: ['attendance-register'] }); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not update request.'),
  });
  return (
    <Modal open onClose={onClose} title={`Modify leave · ${req.user.name}`} icon={<Pencil size={16} />}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.changeReason.trim()} onClick={() => { setError(''); save.mutate(); }}>Save changes</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Leave type">
          <SearchableSelect value={form.leaveTypeId} onChange={val => setForm(f => ({ ...f, leaveTypeId: val }))} options={(types || []).map(t => ({ value: t.id, label: t.name }))} />
        </Field>
        <div className="flex items-center gap-4">
          <Checkbox label="Half day" checked={form.halfDay} onChange={e => setForm(f => ({ ...f, halfDay: e.target.checked }))} />
          {form.halfDay && <Select value={form.halfDayPeriod} onChange={e => setForm(f => ({ ...f, halfDayPeriod: e.target.value as 'AM' | 'PM' }))} className="w-40"><option value="AM">First half</option><option value="PM">Second half</option></Select>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={form.halfDay ? 'Date' : 'Start date'}><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
          {!form.halfDay && <Field label="End date"><Input type="date" value={form.endDate} min={form.startDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></Field>}
        </div>
        <Field label="Employee's reason"><Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></Field>
        <Field label="Why are you changing this?" required><Textarea rows={2} value={form.changeReason} onChange={e => setForm(f => ({ ...f, changeReason: e.target.value }))} placeholder="Recorded in the audit log" /></Field>
      </div>
    </Modal>
  );
}

function AdminCancelModal({ req, onClose }: { req: LeaveRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.post(`/hr/leave/requests/${req.id}/admin-cancel`, { reason }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leave-requests'] }); qc.invalidateQueries({ queryKey: ['leave-balance'] }); qc.invalidateQueries({ queryKey: ['attendance-register'] }); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not cancel request.'),
  });
  return (
    <Modal open onClose={onClose} title="Cancel approved leave" size="sm" icon={<Ban size={16} />}
      footer={<><Button variant="secondary" onClick={onClose}>Keep</Button><Button variant="danger" loading={cancel.isPending} disabled={!reason.trim()} onClick={() => { setError(''); cancel.mutate(); }}>Cancel leave</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm text-fg-muted">{req.user.name} · {req.leaveType.name} · {fmtDays(req.days)}. The balance is restored and attendance for those days is recomputed.</p>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></Field>
      </div>
    </Modal>
  );
}

function AdjustBalanceModal({ user, year, onClose }: { user: { id: string; name: string }; year: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: types } = useQuery<LeaveType[]>({ queryKey: ['leave-types'], queryFn: () => api.get('/hr/leave/types').then(r => r.data) });
  const [form, setForm] = useState({ leaveTypeId: '', days: 1, reason: '' });
  const [error, setError] = useState('');
  const adjust = useMutation({
    mutationFn: () => api.post('/hr/leave/balances/adjust', { userId: user.id, year, ...form }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leave-balance'] }); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not adjust balance.'),
  });
  return (
    <Modal open onClose={onClose} title={`Adjust balance · ${user.name}`} size="sm" icon={<SlidersHorizontal size={16} />}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={adjust.isPending} disabled={!form.leaveTypeId || !form.days || !form.reason.trim()} onClick={() => { setError(''); adjust.mutate(); }}>Apply adjustment</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Leave type"><SearchableSelect value={form.leaveTypeId} onChange={val => setForm(f => ({ ...f, leaveTypeId: val }))} options={(types || []).filter(t => !t.isUnlimited).map(t => ({ value: t.id, label: t.name }))} /></Field>
        <Field label="Days (negative to deduct)" hint={`Applies to ${year}`}><Input type="number" step="0.5" value={form.days} onChange={e => setForm(f => ({ ...f, days: Number(e.target.value) }))} /></Field>
        <Field label="Reason" required><Textarea rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Compensatory off for weekend release" /></Field>
      </div>
    </Modal>
  );
}

function RequestRow({ req, showEmployee, onCancel, onApprove, onReject, onModify, onAdminCancel }: {
  req: LeaveRequest; showEmployee?: boolean;
  onCancel?: () => void; onApprove?: () => void; onReject?: () => void; onModify?: () => void; onAdminCancel?: () => void;
}) {
  const { date } = useFormat();
  return (
    <div className="flex items-center justify-between gap-3 py-3.5 border-b border-line-subtle last:border-0 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {showEmployee && <span className="font-bold text-fg text-[15px] truncate" title={req.user.name}>{req.user.name}</span>}
          <span className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: `${req.leaveType.color}20`, color: req.leaveType.color }}>
            {req.leaveType.name}
          </span>
          <StatusBadge value={req.status} map={approvalStatusVariant} dot />
        </div>
        <p className="text-[12.5px] text-fg-muted mt-1 tabular-nums">
          {req.halfDay ? `${date(req.startDate)} · ${req.halfDayPeriod === 'PM' ? 'second' : 'first'} half` : `${date(req.startDate)} → ${date(req.endDate)}`} · {fmtDays(req.days)}
        </p>
        {req.reason && <p className="text-xs text-fg-subtle mt-0.5">{req.reason}</p>}
        {req.status === 'REJECTED' && req.rejectionReason && (
          <p className="text-xs text-danger mt-0.5">Reason: {req.rejectionReason}</p>
        )}
        {req.status === 'CANCELLED' && req.cancelReason && (
          <p className="text-xs text-fg-subtle mt-0.5">Cancelled: {req.cancelReason}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onCancel && req.status === 'PENDING' && (
          <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
        )}
        {onApprove && req.status === 'PENDING' && (
          <>
            <Button size="xs" icon={<Check size={12} />} onClick={onApprove}>Approve</Button>
            <Button size="xs" variant="danger" icon={<X size={12} />} onClick={onReject}>Reject</Button>
          </>
        )}
        {onModify && (req.status === 'PENDING' || req.status === 'APPROVED') && (
          <Button size="xs" variant="ghost" icon={<Pencil size={12} />} onClick={onModify}>Modify</Button>
        )}
        {onAdminCancel && req.status === 'APPROVED' && (
          <Button size="xs" variant="ghost" icon={<Ban size={12} />} onClick={onAdminCancel}>Cancel leave</Button>
        )}
      </div>
    </div>
  );
}

function MyLeave() {
  const qc = useQueryClient();
  const [applyOpen, setApplyOpen] = useState(false);
  const { data, isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ['leave-requests', 'mine'],
    queryFn: () => api.get('/hr/leave/requests').then(r => r.data),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/hr/leave/requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-requests'] }),
  });

  const mine = data || [];
  const thisYear = new Date().getFullYear();
  const countOf = (status: string) => mine.filter(r => r.status === status).length;
  const daysTaken = mine
    .filter(r => r.status === 'APPROVED' && new Date(r.startDate).getFullYear() === thisYear)
    .reduce((sum, r) => sum + Number(r.days), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-4">
        <PastelStatCard variant="soft" tone="orange" icon={Clock3}       label="Pending"              value={isLoading ? '…' : countOf('PENDING')} />
        <PastelStatCard variant="soft" tone="green"  icon={CheckCircle2} label="Approved"             value={isLoading ? '…' : countOf('APPROVED')} />
        <PastelStatCard variant="soft" tone="red"    icon={XCircle}      label="Rejected"             value={isLoading ? '…' : countOf('REJECTED')} />
        <PastelStatCard variant="soft" tone="blue"   icon={CalendarDays} label={`Days taken ${thisYear}`} value={isLoading ? '…' : daysTaken} />
      </div>
      <BalanceCards />
      <Card>
        <CardHeader
          title="My Requests"
          className="mb-3"
          actions={<Button icon={<Plus size={14} />} onClick={() => setApplyOpen(true)}>Apply for Leave</Button>}
        />
        {isLoading ? <SkeletonTable rows={3} /> : (data || []).length === 0 ? (
          <EmptyState
            compact
            icon={<CalendarCheck />}
            title="No leave requests yet"
            description="When you need time off, apply here and your manager will be notified."
            action={{ label: 'Apply for leave', onClick: () => setApplyOpen(true) }}
          />
        ) : (
          <div>{(data || []).map(r => <RequestRow key={r.id} req={r} onCancel={() => cancel.mutate(r.id)} />)}</div>
        )}
      </Card>
      <ApplyModal open={applyOpen} onClose={() => setApplyOpen(false)} />
    </div>
  );
}

function Approvals() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [modifying, setModifying] = useState<LeaveRequest | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ['leave-requests', 'org'],
    queryFn: () => api.get('/hr/leave/requests', { params: { scope: 'org' } }).then(r => r.data),
  });
  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/hr/leave/requests/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-requests'] }),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.patch(`/hr/leave/requests/${id}/reject`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leave-requests'] }); setRejecting(null); setReason(''); },
  });

  const pending = (data || []).filter(r => r.status === 'PENDING');
  const decided = (data || []).filter(r => r.status !== 'PENDING');

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={`Pending Approval (${pending.length})`} icon={<Clock3 size={14} />} className="mb-3" />
        {isLoading ? <SkeletonTable rows={3} /> : pending.length === 0 ? (
          <EmptyState
            compact
            icon={<CheckCircle2 />}
            title="All caught up"
            description="Nothing is waiting on your approval right now."
          />
        ) : (
          <div>{pending.map(r => (
            <RequestRow key={r.id} req={r} showEmployee
              onApprove={() => approve.mutate(r.id)}
              onReject={() => setRejecting(r)}
              onModify={() => setModifying(r)}
            />
          ))}</div>
        )}
      </Card>
      {decided.length > 0 && (
        <Card>
          <CardHeader title="History" className="mb-3" />
          <div>{decided.map(r => <RequestRow key={r.id} req={r} showEmployee onModify={() => setModifying(r)} onAdminCancel={() => setCancelling(r)} />)}</div>
        </Card>
      )}

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject leave request" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason })} loading={reject.isPending} disabled={!reason.trim()}>
            Reject
          </Button>
        </>}>
        <Field label="Reason">
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Let them know why" autoFocus />
        </Field>
      </Modal>
      {modifying && <ModifyModal req={modifying} onClose={() => setModifying(null)} />}
      {cancelling && <AdminCancelModal req={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function EmployeeLeave() {
  const { data: users } = useUsers();
  const [userId, setUserId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [applyOpen, setApplyOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [modifying, setModifying] = useState<LeaveRequest | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const selected = users?.find(u => u.id === userId);
  const { data: requests, isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ['leave-requests', 'org', userId],
    queryFn: () => api.get('/hr/leave/requests', { params: { scope: 'org', userId } }).then(r => r.data),
    enabled: !!userId,
  });
  const { data: balances } = useBalances(userId || undefined, year);
  const rows = (requests || []).filter(r => r.user.id === userId && new Date(r.startDate).getFullYear() === year);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Employee leave" subtitle="View balances, apply on someone's behalf, and adjust entitlements" className="mb-3" />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Employee" className="min-w-[16rem] flex-1">
            <SearchableSelect value={userId} onChange={setUserId} options={(users || []).map(u => ({ value: u.id, label: u.department ? `${u.name} · ${u.department}` : u.name }))} placeholder="Pick an employee…" />
          </Field>
          <Field label="Year"><Select value={year} onChange={e => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].sort().map(y => <option key={y} value={y}>{y}</option>)}</Select></Field>
          <Button icon={<UserPlus size={14} />} disabled={!userId} onClick={() => setApplyOpen(true)}>Apply on behalf</Button>
          <Button variant="secondary" icon={<SlidersHorizontal size={14} />} disabled={!userId} onClick={() => setAdjustOpen(true)}>Adjust balance</Button>
        </div>
      </Card>

      {selected && (
        <>
          <div className="flex items-center gap-2"><Avatar name={selected.name} src={selected.avatarUrl ?? undefined} size="sm" /><div><div className="text-sm font-medium text-fg">{selected.name}</div><div className="text-xs text-fg-subtle">{selected.department || selected.email}</div></div></div>
          <BalanceCards userId={userId} year={year} />
          {!!balances?.some(b => b.adjustments) && (
            <div className="flex flex-wrap gap-2">
              {balances!.filter(b => b.adjustments).map(b => <Badge key={b.leaveType.id} variant={b.adjustments > 0 ? 'green' : 'yellow'}>{b.leaveType.name}: {b.adjustments > 0 ? '+' : ''}{b.adjustments} adjusted</Badge>)}
            </div>
          )}
          <Card>
            <CardHeader title={`Requests in ${year}`} className="mb-3" />
            {isLoading ? <SkeletonTable rows={3} /> : rows.length === 0 ? (
              <EmptyState compact icon={<CalendarCheck />} title="No leave this year" description="Nothing has been applied for this employee yet." />
            ) : (
              <div>{rows.map(r => <RequestRow key={r.id} req={r} onModify={() => setModifying(r)} onAdminCancel={() => setCancelling(r)} />)}</div>
            )}
          </Card>
          <ApplyModal open={applyOpen} onClose={() => setApplyOpen(false)} onBehalfOf={{ id: selected.id, name: selected.name }} />
          {adjustOpen && <AdjustBalanceModal user={{ id: selected.id, name: selected.name }} year={year} onClose={() => setAdjustOpen(false)} />}
          {modifying && <ModifyModal req={modifying} onClose={() => setModifying(null)} />}
          {cancelling && <AdminCancelModal req={cancelling} onClose={() => setCancelling(null)} />}
        </>
      )}
    </div>
  );
}

export default function LeavePage() {
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.includes(user?.role || '');
  const [tab, setTab] = useState<'me' | 'approvals' | 'employees'>('me');

  return (
    <div>
      <PageHeader
        title="Leave"
        icon={CalendarCheck}
        subtitle="Apply for and track time off"
        below={isManager ? (
          <Tabs<'me' | 'approvals' | 'employees'>
            aria-label="Leave views"
            variant="pill"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'me', label: 'My Leave' },
              { key: 'approvals', label: 'Approvals' },
              { key: 'employees', label: 'Employees' },
            ]}
          />
        ) : undefined}
      />

      <PageBody width="full" className="max-w-6xl mx-auto">
        {tab === 'me' ? <MyLeave /> : tab === 'approvals' ? <Approvals /> : <EmployeeLeave />}
      </PageBody>
    </div>
  );
}
