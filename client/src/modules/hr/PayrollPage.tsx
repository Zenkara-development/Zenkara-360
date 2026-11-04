import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import {
  PageHeader, PageBody, Card, CardHeader, Tabs, Button, Modal, StatusBadge, EmptyState,
  Field, Input, Select, Alert,
  IconButton, DataTable, SkeletonTable, Avatar, type BadgeProps,
} from '../../shared/components';
import { Wallet, FileText, PlayCircle, CheckCircle2, Printer, RefreshCw, Send, XCircle, FileDown, Mail, Search } from 'lucide-react';
import { PayslipTemplatesSection } from './payroll/PayslipTemplatesSection';
import { downloadPdf, useEmailPayslip, useEmailRun } from '../../api/payslipTemplates';
import { SalaryComponentsSection } from './payroll/SalaryComponentsSection';
import { EmployeeSalariesSection, PayslipLines } from './payroll/EmployeeSalariesSection';
import { PayrollCyclesSection } from './payroll/PayrollCyclesSection';
import { usePayrollCycles, type Line, type AttendanceBasis } from '../../api/payroll';
import { useFormat } from '../../hooks/useFormat';

const MANAGER_ROLES = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'];

/** Shared with the payroll-run and payslip chips: paid is settled (green),
 *  anything else is still in flight (yellow). */
const PAYSLIP_STATUS_VARIANT: Record<string, NonNullable<BadgeProps['variant']>> = {
  PAID: 'green', GENERATED: 'yellow', PENDING: 'yellow', DRAFT: 'gray',
};
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface EmployeeRef { id: string; name: string; email: string; department?: string | null; avatarUrl?: string | null }

interface Payslip {
  id: string; payslipNumber: string; month: number; year: number;
  basic: string; hra: string; allowances: string; grossPay: string;
  pf: string; professionalTax: string; otherDeductions: string; totalDeductions: string; netPay: string;
  totalEarnings?: string | null; totalReimbursements?: string | null; employerContributions?: string | null;
  periodStart?: string | null; periodEnd?: string | null; paidDays?: string | null; workingDays?: string | null; lopDays?: string | null;
  presentDays?: string | null; leaveDays?: string | null; halfDays?: string | null; overtimeHours?: string | null;
  attendanceSummary?: (AttendanceBasis & { source?: 'attendance' | 'calendar'; warnings?: string[] }) | null;
  status: string; paidAt: string | null; createdAt: string; emailedAt?: string | null;
  user: EmployeeRef;
  lines?: Line[];
  payrollRun?: { id: string; status: string; periodStart: string | null; periodEnd: string | null; payrollCycle?: { name: string; frequency: string } | null };
}

interface PayrollRun {
  id: string; month: number; year: number; status: string; runAt: string; finalizedAt?: string | null;
  periodStart?: string | null; periodEnd?: string | null; attendanceMode?: 'ATTENDANCE' | 'CALENDAR' | null;
  payrollCycle?: { id: string; name: string; frequency: string } | null;
  runByUser: { id: string; name: string };
  payslips?: Payslip[];
  _count?: { payslips: number };
}

function periodLabel(r: { month: number; year: number; periodStart?: string | null; periodEnd?: string | null; payrollCycle?: { frequency: string } | null }) {
  if (r.periodStart && r.periodEnd && r.payrollCycle && r.payrollCycle.frequency !== 'MONTHLY') return `${r.periodStart.slice(0, 10)} – ${r.periodEnd.slice(0, 10)}`;
  return `${MONTH_NAMES[r.month]} ${r.year}`;
}

function payslipTotals(p: Payslip) {
  return {
    earnings: Number(p.totalEarnings ?? p.grossPay), deductions: Number(p.totalDeductions),
    reimbursements: Number(p.totalReimbursements ?? 0), employerContributions: Number(p.employerContributions ?? 0), net: Number(p.netPay),
  };
}


// ─── Payroll runs (managers) ────────────────────────────────────────────────

function RunModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: cycles } = usePayrollCycles();
  const [cycleId, setCycleId] = useState('');
  const [on, setOn] = useState(() => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 10); });
  const [attendanceMode, setAttendanceMode] = useState<'ATTENDANCE' | 'CALENDAR'>('ATTENDANCE');
  const [error, setError] = useState('');
  const cycle = (cycles ?? []).find(c => c.id === cycleId) ?? (cycles ?? []).find(c => c.isDefault);

  const run = useMutation({
    mutationFn: () => api.post('/hr/payroll/runs', { payrollCycleId: cycle?.id, on, attendanceMode }).then(r => r.data),
    onSuccess: (data: any) => { qc.invalidateQueries({ queryKey: ['payroll-runs'] }); onClose(); onCreated(data.id); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not run payroll.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Run payroll" icon={<PlayCircle size={16} />} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { setError(''); run.mutate(); }} loading={run.isPending}>Calculate draft</Button>
      </>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-xs text-fg-subtle">Calculates a draft payslip for every employee on the cycle. You review and adjust before anything is issued.</p>
        <Field label="Payroll cycle">
          <Select value={cycle?.id ?? ''} onChange={e => setCycleId(e.target.value)}>
            {(cycles ?? []).map(c => <option key={c.id} value={c.id}>{c.name} ({c.frequency.toLowerCase()}) · {c._count?.salaries ?? 0} employees</option>)}
          </Select>
        </Field>
        <Field label="Any date inside the period" hint="Defaults to last month; the cycle decides the exact period">
          <Input type="date" value={on} onChange={e => setOn(e.target.value)} />
        </Field>
        <Field label="Paid days come from" hint={attendanceMode === 'ATTENDANCE' ? 'Working days, LOP, half days and overtime are read from the attendance register (policies, holidays, leave, corrections).' : 'Every calendar day is paid in full — use this only if attendance is not tracked yet.'}>
          <Select value={attendanceMode} onChange={e => setAttendanceMode(e.target.value as 'ATTENDANCE' | 'CALENDAR')}>
            <option value="ATTENDANCE">Attendance register (recommended)</option>
            <option value="CALENDAR">Calendar — pay every day</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

const DAY_LABELS: Record<string, string> = { PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave', UNPAID_LEAVE: 'Unpaid leave', WFH: 'WFH', HOLIDAY: 'Holiday', WEEK_OFF: 'Week off', LOP: 'LOP' };

function AttendanceBasisPanel({ payslip }: { payslip: Payslip }) {
  const a = payslip.attendanceSummary;
  if (!a || a.source !== 'attendance') {
    return <p className="text-[10.5px] text-fg-subtle mb-2">Days: {Number(payslip.paidDays ?? 0)} paid of {Number(payslip.workingDays ?? 0)} (calendar mode).</p>;
  }
  const n = (v: string | null | undefined) => Number(v ?? 0);
  const order = ['PRESENT', 'LATE', 'WFH', 'HALF_DAY', 'LEAVE', 'UNPAID_LEAVE', 'ABSENT', 'LOP', 'HOLIDAY', 'WEEK_OFF'];
  return (
    <div className="mb-3 rounded-lg border border-line-subtle bg-surface p-2.5 text-[11px]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-medium text-fg">Attendance basis</span>
        <span className="text-fg-subtle">{a.policyGroup}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center tabular-nums">
        <div className="rounded bg-surface-sunken py-1"><div className="text-[9.5px] uppercase text-fg-subtle">Working</div><div className="font-semibold text-fg">{n(payslip.workingDays)}</div></div>
        <div className="rounded bg-surface-sunken py-1"><div className="text-[9.5px] uppercase text-fg-subtle">Paid</div><div className="font-semibold text-fg">{n(payslip.paidDays)}</div></div>
        <div className="rounded bg-surface-sunken py-1"><div className="text-[9.5px] uppercase text-fg-subtle">LOP</div><div className={`font-semibold ${n(payslip.lopDays) ? 'text-danger' : 'text-fg'}`}>{n(payslip.lopDays)}</div></div>
        <div className="rounded bg-surface-sunken py-1"><div className="text-[9.5px] uppercase text-fg-subtle">OT hrs</div><div className="font-semibold text-fg">{n(payslip.overtimeHours)}</div></div>
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1.5 text-fg-muted">
        {order.filter(k => a.byStatus?.[k]).map(k => <span key={k}>{DAY_LABELS[k] ?? k} <strong className="text-fg tabular-nums">{a.byStatus![k]}</strong></span>)}
      </div>
      {(a.lateCount ?? 0) > 0 && <p className="mt-1 text-fg-muted">{a.lateCount} late arrival{a.lateCount === 1 ? '' : 's'}{a.lateConversion?.extraLopDays ? ` → ${a.lateConversion.extraLopDays} LOP day${a.lateConversion.extraLopDays === 1 ? '' : 's'} (${a.lateConversion.note})` : ''}</p>}
      {(a.futureDaysAssumedPaid ?? 0) > 0 && <p className="mt-1 text-warning">{a.futureDaysAssumedPaid} future day{a.futureDaysAssumedPaid === 1 ? '' : 's'} assumed paid — recalculate once the period ends.</p>}
      {(a.manualCorrections ?? 0) > 0 && <p className="mt-1 text-fg-subtle">{a.manualCorrections} manually corrected day{a.manualCorrections === 1 ? '' : 's'} included.</p>}
    </div>
  );
}

function RunReviewModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { money } = useFormat();
  const [selected, setSelected] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<{ code: string; amount: string } | null>(null);
  const [error, setError] = useState('');
  const { data: run, isLoading } = useQuery<PayrollRun>({ queryKey: ['payroll-run', runId], queryFn: () => api.get(`/hr/payroll/runs/${runId}`).then(r => r.data) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll-runs'] }); qc.invalidateQueries({ queryKey: ['payroll-run', runId] }); };
  const onErr = (e: any) => setError(e?.response?.data?.error || 'Something went wrong');
  const recalc = useMutation({ mutationFn: () => api.post(`/hr/payroll/runs/${runId}/recalculate`), onSuccess: refresh, onError: onErr });
  const finalize = useMutation({ mutationFn: () => api.post(`/hr/payroll/runs/${runId}/finalize`), onSuccess: refresh, onError: onErr });
  const discard = useMutation({ mutationFn: () => api.delete(`/hr/payroll/runs/${runId}`), onSuccess: () => { refresh(); onClose(); }, onError: onErr });
  const markPaid = useMutation({ mutationFn: () => api.patch(`/hr/payroll/runs/${runId}/mark-paid`), onSuccess: refresh, onError: onErr });
  const adjustLine = useMutation({
    mutationFn: ({ payslipId, code, amount }: { payslipId: string; code: string; amount: number }) => api.patch(`/hr/payroll/runs/${runId}/payslips/${payslipId}`, { code, amount }),
    onSuccess: () => { refresh(); setAdjust(null); }, onError: onErr,
  });
  const emailOne = useEmailPayslip();
  const emailAll = useEmailRun();
  const [mailNotice, setMailNotice] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const isDraft = run?.status === 'DRAFT';
  const payslips = run?.payslips ?? [];
  const current = payslips.find(p => p.id === selected) ?? null;
  const sum = (k: 'grossPay' | 'totalDeductions' | 'netPay') => payslips.reduce((s, p) => s + Number(p[k]), 0);
  const totalLop = payslips.reduce((s, p) => s + Number(p.lopDays ?? 0), 0);
  const projected = payslips.reduce((s, p) => s + Number(p.attendanceSummary?.futureDaysAssumedPaid ?? 0), 0);
  const fromAttendance = run?.attendanceMode !== 'CALENDAR';

  return (
    <Modal open onClose={onClose} title={run ? `${periodLabel(run)} · ${run.payrollCycle?.name ?? 'Monthly'}` : 'Payroll run'} icon={<FileText size={16} />} size="xl"
      subtitle={run ? (isDraft ? 'Draft — review, adjust, then finalise to issue payslips.' : `${run.status === 'PAID' ? 'Paid' : 'Finalised'} · run by ${run.runByUser?.name}`) : undefined}
      footer={run ? (
        <>
          {isDraft && <Button variant="ghost" icon={<XCircle size={13} />} loading={discard.isPending} onClick={() => discard.mutate()}>Discard draft</Button>}
          <span className="mr-auto" />
          {isDraft && <Button variant="secondary" icon={<RefreshCw size={13} />} loading={recalc.isPending} onClick={() => recalc.mutate()}>Recalculate</Button>}
          {isDraft && <Button icon={<Send size={13} />} loading={finalize.isPending} onClick={() => finalize.mutate()}>Finalise &amp; issue payslips</Button>}
          {!isDraft && <Button variant="secondary" icon={<FileDown size={13} />} loading={pdfBusy} onClick={async () => { setPdfBusy(true); try { await downloadPdf(`/hr/payroll/runs/${runId}/pdf`, `payslips-${run.year}-${String(run.month).padStart(2, '0')}.pdf`); } catch { setError('Could not build the PDF'); } finally { setPdfBusy(false); } }}>All payslips (PDF)</Button>}
          {!isDraft && <Button variant="secondary" icon={<Mail size={13} />} loading={emailAll.isPending} onClick={() => emailAll.mutate({ id: runId }, { onSuccess: r => setMailNotice(`${r.sent} e-mailed${r.skipped ? `, ${r.skipped} already sent` : ''}${r.failed.length ? `, ${r.failed.length} failed (no e-mail address)` : ''}.`), onError: onErr })}>E-mail payslips</Button>}
          {run.status === 'PROCESSED' && <Button icon={<CheckCircle2 size={13} />} loading={markPaid.isPending} onClick={() => markPaid.mutate()}>Mark all paid</Button>}
        </>
      ) : undefined}>
      {error && <Alert tone="danger" className="mb-3" onDismiss={() => setError('')}>{error}</Alert>}
      {mailNotice && <Alert tone="success" className="mb-3" onDismiss={() => setMailNotice('')}>{mailNotice}</Alert>}
      {run && isDraft && fromAttendance && projected > 0 && (
        <Alert tone="warning" className="mb-3">This period is not over yet — {projected} future day{projected === 1 ? '' : 's'} across the run are assumed paid. Recalculate after the period ends (or after attendance corrections) before finalising.</Alert>
      )}
      {run && isDraft && !fromAttendance && <Alert tone="info" className="mb-3">Calendar mode: every day is paid in full; the attendance register was not consulted.</Alert>}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)] gap-4">
        <div>
          {run && (
            <div className="flex flex-wrap gap-4 text-xs text-fg-muted mb-3 tabular-nums">
              <span>{payslips.length} payslips</span><span>Gross {money(sum('grossPay'))}</span><span>Deductions {money(sum('totalDeductions'))}</span><span className="font-semibold text-fg">Net {money(sum('netPay'))}</span>{fromAttendance && <span className={totalLop ? 'text-danger' : ''}>LOP {totalLop} day{totalLop === 1 ? '' : 's'}</span>}
            </div>
          )}
          <DataTable<Payslip>
            minWidth={480}
            loading={isLoading}
            rows={payslips}
            rowKey={p => p.id}
            onRowClick={p => setSelected(p.id)}
            columns={[
              { key: 'employee', header: 'Employee', cell: p => <span className={`truncate ${selected === p.id ? 'font-semibold text-accent' : ''}`} title={p.user.name}>{p.user.name}</span> },
              { key: 'days', header: 'Paid days', align: 'right', hideBelow: 'sm', muted: true, cell: p => <span className={`tabular-nums ${Number(p.lopDays) > 0 ? 'text-danger' : ''}`}>{p.paidDays != null ? `${Number(p.paidDays)}/${Number(p.workingDays)}` : '—'}{Number(p.attendanceSummary?.futureDaysAssumedPaid ?? 0) > 0 && <span title={`${p.attendanceSummary!.futureDaysAssumedPaid} future days assumed paid`} className="text-warning"> ●</span>}</span> },
              { key: 'gross', header: 'Gross', align: 'right', cell: p => <span className="tabular-nums">{money(p.grossPay)}</span> },
              { key: 'deductions', header: 'Deductions', align: 'right', muted: true, hideBelow: 'sm', cell: p => <span className="tabular-nums">{money(p.totalDeductions)}</span> },
              { key: 'net', header: 'Net Pay', align: 'right', cell: p => <span className="font-medium tabular-nums">{money(p.netPay)}</span> },
              { key: 'status', header: '', cell: p => <span className="inline-flex items-center gap-1"><StatusBadge value={p.status} map={PAYSLIP_STATUS_VARIANT} fallback="yellow" />{p.lines?.some(l => l.adjusted) && <span title="Has manual adjustments" className="text-warning">●</span>}</span> },
              { key: 'actions', header: '', align: 'right', cell: p => !isDraft ? (
                <span className="inline-flex items-center">
                  <IconButton label="Open print view" tone="accent" icon={<Printer size={14} />} onClick={() => window.open(`/hr/payroll/payslips/${p.id}/print`, '_blank')} />
                  <IconButton label="Download PDF" icon={<FileDown size={14} />} onClick={() => downloadPdf(`/hr/payroll/payslips/${p.id}/pdf`, `${p.payslipNumber}.pdf`)} />
                  <IconButton label={p.emailedAt ? 'E-mailed — send again' : 'E-mail to employee'} tone={p.emailedAt ? 'success' : 'default'} icon={<Mail size={14} />} onClick={() => emailOne.mutate(p.id, { onSuccess: r => setMailNotice(r.ok ? `Sent to ${p.user.name}.` : `Could not send: ${r.reason}`), onError: onErr })} />
                </span>
              ) : null },
            ]}
          />
        </div>
        <aside>
          {current ? (
            <Card tone="sunken" flat padding="sm">
              <p className="text-[12px] font-semibold text-fg mb-2">{current.user.name} · {current.payslipNumber}</p>
              <AttendanceBasisPanel payslip={current} />
              <PayslipLines lines={current.lines ?? []} totals={payslipTotals(current)} currencyMoney={money} />
              {isDraft && (
                <div className="mt-3 pt-3 border-t border-line-subtle">
                  <p className="text-[11px] font-medium text-fg-muted mb-1.5">Adjust a line</p>
                  <div className="flex gap-2">
                    <Select value={adjust?.code ?? ''} onChange={e => { const l = current.lines?.find(x => x.code === e.target.value); setAdjust(l ? { code: l.code, amount: String(l.amount) } : null); }}>
                      <option value="">Pick a line…</option>
                      {(current.lines ?? []).map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                    </Select>
                    <Input type="number" min={0} className="w-28" disabled={!adjust} value={adjust?.amount ?? ''} onChange={e => adjust && setAdjust({ ...adjust, amount: e.target.value })} />
                    <Button size="sm" disabled={!adjust} loading={adjustLine.isPending} onClick={() => adjust && adjustLine.mutate({ payslipId: current.id, code: adjust.code, amount: Number(adjust.amount) })}>Apply</Button>
                  </div>
                  <p className="text-[10.5px] text-fg-subtle mt-1.5">Adjustments survive Recalculate; totals update automatically.</p>
                </div>
              )}
            </Card>
          ) : <p className="text-xs text-fg-subtle p-2">Select an employee to see the breakdown{isDraft ? ' and adjust lines' : ''}.</p>}
        </aside>
      </div>
    </Modal>
  );
}

function PayrollRunsSection() {
  const [runOpen, setRunOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PayrollRun[]>({
    queryKey: ['payroll-runs'],
    queryFn: () => api.get('/hr/payroll/runs').then(r => r.data),
  });

  return (
    <Card>
      <CardHeader
        title="Payroll Runs"
        subtitle="Calculate a draft, review every payslip, adjust where needed, then finalise."
        icon={<FileText size={14} />}
        className="mb-3"
        actions={<Button size="sm" icon={<PlayCircle size={13} />} onClick={() => setRunOpen(true)}>Run Payroll</Button>}
      />

      {isLoading ? <SkeletonTable rows={3} /> : (data || []).length === 0 ? (
        <EmptyState
          compact
          icon={<FileText />}
          title="No payroll runs yet"
          description="Once employee salaries are set up, run payroll to calculate everyone's payslips in one go."
          action={{ label: 'Run payroll', onClick: () => setRunOpen(true) }}
        />
      ) : (
        <div className="space-y-2">
          {(data || []).map(r => (
            <button key={r.id} onClick={() => setViewing(r.id)} className="w-full text-left flex items-center justify-between gap-3 p-3 border border-line-subtle rounded-card flex-wrap hover:border-line-strong hover:bg-surface-hover transition-colors">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-fg text-sm tabular-nums">{periodLabel(r)}</span>
                  {r.payrollCycle && <span className="text-xs text-fg-subtle">{r.payrollCycle.name}</span>}
                  <StatusBadge value={r.status} map={PAYSLIP_STATUS_VARIANT} fallback="yellow" dot />
                </div>
                <p className="text-xs text-fg-subtle mt-0.5 tabular-nums">
                  {r._count?.payslips ?? 0} payslip{(r._count?.payslips ?? 0) === 1 ? '' : 's'} · run by {r.runByUser?.name}{r.status === 'DRAFT' ? ' · awaiting review' : ''}
                </p>
              </div>
              <Button size="xs" variant="ghost">{r.status === 'DRAFT' ? 'Review' : 'View'}</Button>
            </button>
          ))}
        </div>
      )}

      <RunModal open={runOpen} onClose={() => setRunOpen(false)} onCreated={id => setViewing(id)} />
      {viewing && <RunReviewModal runId={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}

// ─── My Payslips (everyone) ──────────────────────────────────────────────────

function PayslipDetail({ payslip, onClose }: { payslip: Payslip; onClose: () => void }) {
  const { money, date } = useFormat();
  return (
    <Modal open onClose={onClose} title={payslip.payslipNumber} subtitle={periodLabel({ ...payslip, payrollCycle: payslip.payrollRun?.payrollCycle })} icon={<FileText size={16} />}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="secondary" icon={<Printer size={13} />} onClick={() => window.open(`/hr/payroll/payslips/${payslip.id}/print`, '_blank')}>Print view</Button>
        <Button icon={<FileDown size={13} />} onClick={() => downloadPdf(`/hr/payroll/payslips/${payslip.id}/pdf`, `${payslip.payslipNumber}.pdf`)}>Download PDF</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="font-medium text-fg truncate" title={payslip.user.name}>{payslip.user.name}</p>
            <p className="text-xs text-fg-subtle truncate">{payslip.user.department || payslip.user.email}</p>
          </div>
          <StatusBadge value={payslip.status} map={PAYSLIP_STATUS_VARIANT} fallback="yellow" dot />
        </div>
        <div className="border-t border-line-subtle pt-3">
          {payslip.lines?.length ? <PayslipLines lines={payslip.lines.filter(l => l.showOnPayslip !== false)} totals={payslipTotals(payslip)} currencyMoney={money} /> : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm tabular-nums">
              <p className="text-fg-muted">Basic</p><p className="text-right text-fg">{money(payslip.basic)}</p>
              <p className="text-fg-muted">HRA</p><p className="text-right text-fg">{money(payslip.hra)}</p>
              <p className="text-fg-muted">Allowances</p><p className="text-right text-fg">{money(payslip.allowances)}</p>
              <p className="font-medium text-fg border-t border-line-subtle pt-2">Gross Pay</p><p className="text-right font-medium text-fg border-t border-line-subtle pt-2">{money(payslip.grossPay)}</p>
              <p className="text-fg-muted">Deductions</p><p className="text-right text-danger">-{money(payslip.totalDeductions)}</p>
              <p className="font-semibold text-fg border-t border-line pt-2">Net Pay</p><p className="text-right font-semibold text-fg border-t border-line pt-2">{money(payslip.netPay)}</p>
            </div>
          )}
          {payslip.paidDays != null && <p className="text-[11px] text-fg-subtle mt-2 tabular-nums">Paid days {Number(payslip.paidDays)} of {Number(payslip.workingDays)}{Number(payslip.lopDays) > 0 ? ` · LOP ${Number(payslip.lopDays)}` : ''}</p>}
        </div>
        {payslip.paidAt && <p className="text-xs text-fg-subtle">Paid on {date(payslip.paidAt)}</p>}
      </div>
    </Modal>
  );
}

/** Basic / Allowances / Deductions / Net Pay table with a View action —
 *  the shared shape of the team and personal payslip lists. "Allowances"
 *  is every earning other than basic, so component-based payslips (where
 *  hra/allowances may be zero and the money sits in lines) still add up. */
function PayslipTable({ rows, loading, showEmployee, onView, empty }: {
  rows: Payslip[]; loading: boolean; showEmployee: boolean;
  onView: (p: Payslip) => void; empty: React.ReactNode;
}) {
  const { money } = useFormat();
  return (
    <Card padding="none" className="overflow-hidden">
      <DataTable<Payslip>
        minWidth={showEmployee ? 720 : 620}
        loading={loading}
        rows={rows}
        rowKey={p => p.id}
        empty={empty}
        columns={[
          showEmployee
            ? {
                key: 'employee', header: 'Employee',
                cell: p => (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={p.user.name} src={p.user.avatarUrl ?? undefined} size="sm" />
                    <span className="min-w-0">
                      <span className="block font-medium text-fg truncate" title={p.user.name}>{p.user.name}</span>
                      {p.user.department && <span className="block text-[11px] text-fg-subtle truncate">{p.user.department}</span>}
                    </span>
                  </div>
                ),
              }
            : {
                key: 'period', header: 'Month',
                cell: p => (
                  <span>
                    <span className="block font-medium text-fg tabular-nums">{periodLabel({ ...p, payrollCycle: p.payrollRun?.payrollCycle })}</span>
                    <span className="block text-[11px] text-fg-subtle font-mono">{p.payslipNumber}</span>
                  </span>
                ),
              },
          { key: 'basic', header: 'Basic Salary', cell: p => <span className="tabular-nums">{money(p.basic)}</span> },
          { key: 'allow', header: 'Allowances', cell: p => <span className="tabular-nums">{money(Math.max(0, payslipTotals(p).earnings - Number(p.basic)))}</span> },
          { key: 'ded', header: 'Deductions', cell: p => <span className="tabular-nums">{money(p.totalDeductions)}</span> },
          { key: 'net', header: 'Net Pay', cell: p => <span className="font-bold text-fg tabular-nums">{money(p.netPay)}</span> },
          {
            key: 'action', header: 'Action',
            cell: p => (
              <span className="inline-flex items-center gap-2">
                <Button size="xs" variant="outline" onClick={() => onView(p)}>View</Button>
                <StatusBadge value={p.status} map={PAYSLIP_STATUS_VARIANT} fallback="yellow" size="sm" />
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

const periodKey = (p: { month: number; year: number }) => `${p.year}-${String(p.month).padStart(2, '0')}`;

/** Search box + month picker that sit on the right of the page title. */
function PayslipFilters({ months, month, onMonth, search, onSearch, searchPlaceholder }: {
  months: { key: string; label: string }[]; month: string; onMonth: (m: string) => void;
  search?: string; onSearch?: (s: string) => void; searchPlaceholder?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Month" value={month} onChange={e => onMonth(e.target.value)} className="!w-auto min-w-[160px]">
        <option value="">All months</option>
        {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </Select>
      {onSearch && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
          <Input aria-label="Search employee" value={search} onChange={e => onSearch(e.target.value)} placeholder={searchPlaceholder} className="!pl-9 w-56" />
        </div>
      )}
    </div>
  );
}

function monthOptions(rows: Payslip[]) {
  const seen = new Map<string, string>();
  for (const p of rows) if (!seen.has(periodKey(p))) seen.set(periodKey(p), `${MONTH_NAMES[p.month]} ${p.year}`);
  return Array.from(seen.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([key, label]) => ({ key, label }));
}

// ─── Team pay slips (managers) ───────────────────────────────────────────────

function TeamPayslips() {
  const [viewing, setViewing] = useState<Payslip | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery<Payslip[]>({
    queryKey: ['payslips', 'org'],
    queryFn: () => api.get('/hr/payroll/payslips', { params: { scope: 'org' } }).then(r => r.data),
  });
  // Drafts belong to the run review, not to the issued pay slips list.
  const issued = (data || []).filter(p => p.status !== 'DRAFT');
  const months = monthOptions(issued);
  // Until the user picks, show the latest month that has pay slips.
  const activeMonth = month ?? months[0]?.key ?? '';
  const q = search.trim().toLowerCase();
  const rows = issued.filter(p =>
    (!activeMonth || periodKey(p) === activeMonth) &&
    (!q || p.user.name.toLowerCase().includes(q) || (p.user.department ?? '').toLowerCase().includes(q)),
  );

  return (
    <>
      <div className="flex justify-end">
        <PayslipFilters months={months} month={activeMonth} onMonth={setMonth}
          search={search} onSearch={setSearch} searchPlaceholder="Search employee…" />
      </div>
      <PayslipTable
        rows={rows} loading={isLoading} showEmployee onView={setViewing}
        empty={
          <EmptyState
            compact
            icon={<Wallet />}
            title={issued.length ? 'No pay slips match' : 'No pay slips issued yet'}
            description={issued.length ? 'Try another month or clear the search.' : 'Finalise a payroll run to issue pay slips for your team.'}
          />
        }
      />
      {viewing && <PayslipDetail payslip={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function MyPayslips() {
  const [viewing, setViewing] = useState<Payslip | null>(null);
  const [month, setMonth] = useState('');
  const { data, isLoading } = useQuery<Payslip[]>({
    queryKey: ['payslips', 'mine'],
    queryFn: () => api.get('/hr/payroll/payslips').then(r => r.data),
  });
  const all = data || [];
  const months = monthOptions(all);
  const rows = month ? all.filter(p => periodKey(p) === month) : all;

  return (
    <>
      {months.length > 1 && (
        <div className="flex justify-end">
          <PayslipFilters months={months} month={month} onMonth={setMonth} />
        </div>
      )}
      <PayslipTable
        rows={rows} loading={isLoading} showEmployee={false} onView={setViewing}
        empty={
          <EmptyState
            compact
            icon={<Wallet />}
            title="No payslips yet"
            description="Your payslips will appear here after each payroll run — ready to view and download."
          />
        }
      />
      {viewing && <PayslipDetail payslip={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

// ─── Payslip Template (managers) ─────────────────────────────────────────────

// ─── Page ────────────────────────────────────────────────────────────────────

type PayrollTab = 'team' | 'me' | 'salaries' | 'components' | 'cycles' | 'runs' | 'template';

export default function PayrollPage() {
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.includes(user?.role || '');
  // Managers open on the team's pay slips, as in the reference layout.
  const [tab, setTab] = useState<PayrollTab>(isManager ? 'team' : 'me');
  const header = tab === 'team'
    ? { title: 'Monthly Pay Slips', subtitle: 'View and download monthly salary slips for your team.' }
    : tab === 'me'
      ? { title: 'My Pay Slips', subtitle: 'View and download your monthly salary slips.' }
      : { title: 'Payroll', subtitle: 'Configurable salary components, payroll cycles, runs and payslips' };

  return (
    <div>
      <PageHeader
        title={header.title}
        icon={Wallet}
        subtitle={header.subtitle}
        below={isManager ? (
          <Tabs<PayrollTab>
            aria-label="Payroll views"
            variant="pill"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'team', label: 'Pay Slips' },
              { key: 'me', label: 'My Payslips' },
              { key: 'salaries', label: 'Employee Salaries' },
              { key: 'components', label: 'Salary Components' },
              { key: 'cycles', label: 'Cycles' },
              { key: 'runs', label: 'Payroll Runs' },
              { key: 'template', label: 'Templates' },
            ]}
          />
        ) : undefined}
      />

      <PageBody width="full" className={tab === 'cycles' || tab === 'runs' ? 'max-w-4xl mx-auto' : 'max-w-6xl mx-auto'}>
        {tab === 'team' && isManager && <TeamPayslips />}
        {tab === 'me' && <MyPayslips />}
        {tab === 'salaries' && isManager && <EmployeeSalariesSection />}
        {tab === 'components' && isManager && <SalaryComponentsSection />}
        {tab === 'cycles' && isManager && <PayrollCyclesSection />}
        {tab === 'runs' && isManager && <PayrollRunsSection />}
        {tab === 'template' && isManager && <PayslipTemplatesSection />}
      </PageBody>
    </div>
  );
}
