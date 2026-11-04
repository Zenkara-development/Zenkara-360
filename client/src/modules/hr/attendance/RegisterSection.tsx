import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, History, RotateCcw, CalendarCheck, Pencil } from 'lucide-react';
import { api } from '../../../api/client';
import {
  Card, CardHeader, Button, Modal, Badge, Field, Input, Select, Textarea, Alert, SkeletonTable, EmptyState, Avatar, IconButton,
} from '../../../shared/components';
import {
  useRegister, useMarkDay, useResetDay, useConvertToLeave, useAttendanceAudit,
  STATUS_LABEL, STATUS_SHORT, STATUS_CLASS, type DayStatus, type RegisterDay, type RegisterRow,
} from '../../../api/attendanceAdmin';
import { useFormat } from '../../../hooks/useFormat';

const MANUAL_STATUSES: DayStatus[] = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'WFH', 'LEAVE', 'UNPAID_LEAVE', 'LOP', 'HOLIDAY', 'WEEK_OFF'];

function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function shiftMonth(m: string, delta: number) { const [y, mo] = m.split('-').map(Number); return monthKey(new Date(y, mo - 1 + delta, 1)); }
function monthLabel(m: string) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmtMin = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');

interface RegisterSectionProps { canEdit: boolean; onlyUserId?: string }

export function RegisterSection({ canEdit, onlyUserId }: RegisterSectionProps) {
  const [month, setMonth] = useState(monthKey(new Date()));
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useRegister(month, onlyUserId, canEdit && !onlyUserId);
  const [selected, setSelected] = useState<{ row: RegisterRow; day: RegisterDay } | null>(null);
  const [historyFor, setHistoryFor] = useState<RegisterRow | null>(null);

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(r => r.user.name.toLowerCase().includes(q) || (r.user.department || '').toLowerCase().includes(q));
  }, [data, search]);
  const days = data?.rows?.[0]?.days ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader
        title={onlyUserId ? 'Monthly register' : 'Attendance register'}
        subtitle={onlyUserId ? 'Day-wise status computed from your policy; corrections by HR are marked' : 'Click any day to correct it. Manual corrections are audited.'}
        actions={
          <div className="flex items-center gap-2">
            {!onlyUserId && <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter people…" className="w-44" />}
            <IconButton label="Previous month" icon={<ChevronLeft size={16} />} onClick={() => setMonth(m => shiftMonth(m, -1))} />
            <span className="text-sm font-medium text-fg min-w-[9rem] text-center">{monthLabel(month)}</span>
            <IconButton label="Next month" icon={<ChevronRight size={16} />} onClick={() => setMonth(m => shiftMonth(m, 1))} />
          </div>
        }
      />
      {isLoading ? <SkeletonTable rows={6} /> : isError ? <Alert tone="danger">Could not load the register.</Alert> : rows.length === 0 ? (
        <EmptyState icon={<CalendarCheck size={20} />} title="No people in this register" description="Nothing to show for this month." />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-separate border-spacing-0 min-w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-surface text-left font-medium text-fg-muted px-3 py-2 border-b border-line-subtle min-w-[12rem]">Employee</th>
                {days.map(d => {
                  const dt = new Date(d.date + 'T00:00:00');
                  const isToday = d.date === today;
                  return (
                    <th key={d.date} className={`px-0.5 py-1 border-b border-line-subtle font-normal text-center ${isToday ? 'text-accent font-semibold' : 'text-fg-subtle'}`}>
                      <div className="leading-tight"><div>{dt.getDate()}</div><div className="text-[10px] uppercase">{dt.toLocaleDateString(undefined, { weekday: 'narrow' })}</div></div>
                    </th>
                  );
                })}
                <th className="px-2 py-2 border-b border-line-subtle text-right font-medium text-fg-muted whitespace-nowrap">Paid / Work</th>
                <th className="px-2 py-2 border-b border-line-subtle text-right font-medium text-fg-muted">LOP</th>
                <th className="px-2 py-2 border-b border-line-subtle text-right font-medium text-fg-muted">Late</th>
                <th className="px-2 py-2 border-b border-line-subtle text-right font-medium text-fg-muted">OT</th>
                {canEdit && <th className="px-2 py-2 border-b border-line-subtle" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.user.id} className="group">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 border-b border-line-subtle">
                    <div className="flex items-center gap-2">
                      <Avatar name={row.user.name} src={row.user.avatarUrl ?? undefined} size="xs" />
                      <div className="min-w-0">
                        <div className="font-medium text-fg truncate">{row.user.name}</div>
                        <div className="text-[10px] text-fg-subtle truncate">{row.policyGroup}{row.user.department ? ` · ${row.user.department}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  {row.days.map(d => (
                    <td key={d.date} className="p-0.5 border-b border-line-subtle text-center">
                      <button
                        type="button"
                        disabled={!canEdit}
                        title={`${d.date}: ${STATUS_LABEL[d.status]}${d.source === 'MANUAL' ? ' (manual)' : ''}${d.workedMinutes ? ` · ${fmtMin(d.workedMinutes)}` : ''}${d.lateMinutes ? ` · late ${d.lateMinutes}m` : ''}`}
                        onClick={() => setSelected({ row, day: d })}
                        className={`relative w-7 h-7 rounded font-semibold tabular-nums ${STATUS_CLASS[d.status]} ${canEdit ? 'hover:ring-2 hover:ring-accent/60 cursor-pointer' : 'cursor-default'}`}
                      >
                        {STATUS_SHORT[d.status]}
                        {d.source === 'MANUAL' && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent" aria-label="Manually corrected" />}
                      </button>
                    </td>
                  ))}
                  <td className="px-2 py-1.5 border-b border-line-subtle text-right tabular-nums font-medium text-fg whitespace-nowrap">{row.summary.paidDays} / {row.summary.workingDays}</td>
                  <td className={`px-2 py-1.5 border-b border-line-subtle text-right tabular-nums ${row.summary.lopDays ? 'text-danger font-medium' : 'text-fg-subtle'}`}>{row.summary.lopDays}</td>
                  <td className={`px-2 py-1.5 border-b border-line-subtle text-right tabular-nums ${row.summary.lateCount ? 'text-warning' : 'text-fg-subtle'}`}>{row.summary.lateCount}</td>
                  <td className="px-2 py-1.5 border-b border-line-subtle text-right tabular-nums text-fg-subtle">{row.summary.overtimeHours ? `${row.summary.overtimeHours}h` : '—'}</td>
                  {canEdit && <td className="px-1 border-b border-line-subtle"><IconButton label="Change history" icon={<History size={14} />} size="xs" onClick={() => setHistoryFor(row)} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-[11px] text-fg-subtle border-t border-line-subtle">
            {(Object.keys(STATUS_LABEL) as DayStatus[]).map(s => <span key={s} className="inline-flex items-center gap-1"><span className={`inline-flex w-4 h-4 rounded items-center justify-center font-semibold ${STATUS_CLASS[s]}`}>{STATUS_SHORT[s]}</span>{STATUS_LABEL[s]}</span>)}
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent" /> manual correction</span>
          </div>
        </div>
      )}

      {selected && <DayModal row={selected.row} day={selected.day} canEdit={canEdit} onClose={() => setSelected(null)} />}
      {historyFor && <HistoryModal row={historyFor} onClose={() => setHistoryFor(null)} />}
    </Card>
  );
}

function DayModal({ row, day, canEdit, onClose }: { row: RegisterRow; day: RegisterDay; canEdit: boolean; onClose: () => void }) {
  const { dateTime } = useFormat();
  const mark = useMarkDay();
  const reset = useResetDay();
  const convert = useConvertToLeave();
  const { data: leaveTypes } = useQuery<any[]>({ queryKey: ['leave-types'], queryFn: () => api.get('/hr/leave/types').then(r => r.data), enabled: canEdit });
  const [mode, setMode] = useState<'view' | 'edit' | 'leave'>(canEdit ? 'edit' : 'view');
  const [form, setForm] = useState({ status: day.status, checkInAt: toLocalInput(day.firstInAt), checkOutAt: toLocalInput(day.lastOutAt), notes: day.notes ?? '', reason: '' });
  const [leave, setLeave] = useState({ leaveTypeId: '', halfDay: false, halfDayPeriod: 'AM' as 'AM' | 'PM', reason: '' });
  const [error, setError] = useState('');
  const onErr = (e: any) => setError(e?.response?.data?.error || 'Could not save');

  const submitMark = () => {
    if (!form.reason.trim()) return setError('A reason is required for every correction.');
    mark.mutate({
      userId: row.user.id, date: day.date, status: form.status, notes: form.notes || undefined, reason: form.reason,
      checkInAt: form.checkInAt ? new Date(form.checkInAt).toISOString() : null,
      checkOutAt: form.checkOutAt ? new Date(form.checkOutAt).toISOString() : null,
    }, { onSuccess: onClose, onError: onErr });
  };
  const submitLeave = () => {
    if (!leave.leaveTypeId) return setError('Pick a leave type.');
    if (!leave.reason.trim()) return setError('A reason is required.');
    convert.mutate({ userId: row.user.id, date: day.date, ...leave }, { onSuccess: onClose, onError: onErr });
  };

  return (
    <Modal open onClose={onClose} title={`${row.user.name} · ${day.date}`} icon={<Pencil size={16} />} size="md"
      footer={mode === 'view' ? <Button variant="secondary" onClick={onClose}>Close</Button> : (
        <>
          {day.source === 'MANUAL' && <Button variant="ghost" icon={<RotateCcw size={14} />} loading={reset.isPending} onClick={() => reset.mutate({ userId: row.user.id, date: day.date, reason: form.reason || 'Reset to computed' }, { onSuccess: onClose, onError: onErr })}>Reset to computed</Button>}
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {mode === 'edit' ? <Button loading={mark.isPending} onClick={submitMark}>Save correction</Button> : <Button loading={convert.isPending} onClick={submitLeave}>Convert to leave</Button>}
        </>
      )}>
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Stat label="Status" value={<Badge className={STATUS_CLASS[day.status]}>{STATUS_LABEL[day.status]}</Badge>} />
          <Stat label="Source" value={day.source === 'MANUAL' ? 'Manual' : 'Computed'} />
          <Stat label="Worked" value={fmtMin(day.workedMinutes)} />
          <Stat label="Paid" value={`${Math.round(day.paidFraction * 100)}%`} />
          <Stat label="First in" value={day.firstInAt ? dateTime(day.firstInAt) : '—'} />
          <Stat label="Last out" value={day.lastOutAt ? dateTime(day.lastOutAt) : '—'} />
          <Stat label="Late by" value={day.lateMinutes ? `${day.lateMinutes} min` : '—'} />
          <Stat label="Overtime" value={day.overtimeMinutes ? `${day.overtimeMinutes} min` : '—'} />
        </div>
        {day.reason && <p className="text-xs text-fg-muted">Last correction: {day.reason}</p>}

        {canEdit && (
          <>
            <div className="flex gap-1 border-b border-line-subtle">
              {(['edit', 'leave'] as const).map(m => (
                <button key={m} type="button" onClick={() => { setMode(m); setError(''); }} className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${mode === m ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg'}`}>
                  {m === 'edit' ? 'Correct day' : 'Convert to leave'}
                </button>
              ))}
            </div>
            {mode === 'edit' ? (
              <div className="space-y-3">
                <Field label="Status">
                  <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as DayStatus }))}>
                    {MANUAL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Check-in" hint="Leave blank to keep punches as they are"><Input type="datetime-local" value={form.checkInAt} onChange={e => setForm(f => ({ ...f, checkInAt: e.target.value }))} /></Field>
                  <Field label="Check-out"><Input type="datetime-local" value={form.checkOutAt} onChange={e => setForm(f => ({ ...f, checkOutAt: e.target.value }))} /></Field>
                </div>
                <Field label="Notes (visible to employee)"><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Client visit, regularised" /></Field>
                <Field label="Reason for correction" required><Textarea rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Recorded in the audit log" /></Field>
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Leave type">
                  <Select value={leave.leaveTypeId} onChange={e => setLeave(l => ({ ...l, leaveTypeId: e.target.value }))}>
                    <option value="">Select…</option>
                    {(leaveTypes ?? []).map(t => <option key={t.id} value={t.id}>{t.name}{t.isPaid === false ? ' (unpaid)' : ''}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Duration">
                    <Select value={leave.halfDay ? 'half' : 'full'} onChange={e => setLeave(l => ({ ...l, halfDay: e.target.value === 'half' }))}>
                      <option value="full">Full day</option><option value="half">Half day</option>
                    </Select>
                  </Field>
                  {leave.halfDay && <Field label="Half"><Select value={leave.halfDayPeriod} onChange={e => setLeave(l => ({ ...l, halfDayPeriod: e.target.value as 'AM' | 'PM' }))}><option value="AM">First half</option><option value="PM">Second half</option></Select></Field>}
                </div>
                <Field label="Reason" required><Textarea rows={2} value={leave.reason} onChange={e => setLeave(l => ({ ...l, reason: e.target.value }))} placeholder="Creates an approved leave request and updates the day" /></Field>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg bg-surface-sunken px-2.5 py-2"><div className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</div><div className="mt-0.5 font-medium text-fg">{value}</div></div>;
}

function HistoryModal({ row, onClose }: { row: RegisterRow; onClose: () => void }) {
  const { dateTime } = useFormat();
  const { data, isLoading } = useAttendanceAudit(row.user.id);
  return (
    <Modal open onClose={onClose} title={`Change history · ${row.user.name}`} icon={<History size={16} />} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {isLoading ? <SkeletonTable rows={4} /> : !data?.length ? <EmptyState icon={<History size={20} />} title="No changes yet" description="Manual corrections, leave changes and resets will appear here." /> : (
        <ul className="divide-y divide-line-subtle text-xs">
          {data.map(a => (
            <li key={a.id} className="py-2.5 flex gap-3">
              <div className="w-36 shrink-0 text-fg-subtle tabular-nums">{dateTime(a.changedAt)}</div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-fg"><Badge variant="gray">{a.entityType}</Badge> <span className="ml-1">{a.action.replace(/_/g, ' ').toLowerCase()}</span>{a.date ? <span className="text-fg-subtle"> · {a.date.slice(0, 10)}</span> : null}</div>
                {(a.before?.status || a.after?.status) && <div className="text-fg-muted mt-0.5">{a.before?.status ?? '—'} → <strong>{a.after?.status ?? '—'}</strong></div>}
                {a.reason && <div className="text-fg-muted mt-0.5 italic">“{a.reason}”</div>}
                <div className="text-[11px] text-fg-subtle mt-0.5">by {a.changer?.name}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
