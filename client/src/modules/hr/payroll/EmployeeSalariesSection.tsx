import { useMemo, useState } from 'react';
import { Plus, Pencil, Wallet, Calculator } from 'lucide-react';
import {
  Card, CardHeader, Button, Modal, Badge, EmptyState, Field, Input, Select, Checkbox, Alert, SkeletonTable, IconButton, DataTable, SearchableSelect, Avatar,
} from '../../../shared/components';
import { useUsers } from '../../../api/users';
import { useFormat } from '../../../hooks/useFormat';
import {
  useEmployeeSalaries, useSalaryComponents, usePayrollCycles, useSaveEmployeeSalary, usePreview, CATEGORY_LABEL,
  type EmployeeSalary, type Overrides, type SalaryComponent, type Line,
} from '../../../api/payroll';

type Row = { code: string; amount: string; percent: string; formula: string; enabled: boolean; mode: 'default' | 'amount' | 'percent' | 'formula' };

function rowsFrom(components: SalaryComponent[], overrides: Overrides): Row[] {
  return components.filter(c => c.isActive).map(c => {
    const o = overrides[c.code] ?? {};
    const mode: Row['mode'] = o.formula ? 'formula' : o.percent !== undefined ? 'percent' : o.amount !== undefined ? 'amount' : 'default';
    return { code: c.code, amount: o.amount?.toString() ?? '', percent: o.percent?.toString() ?? '', formula: o.formula ?? '', enabled: o.enabled !== false, mode };
  });
}

function overridesFrom(rows: Row[]): Overrides {
  const out: Overrides = {};
  for (const r of rows) {
    const o: Overrides[string] = {};
    if (!r.enabled) o.enabled = false;
    if (r.mode === 'amount' && r.amount !== '') o.amount = Number(r.amount);
    if (r.mode === 'percent' && r.percent !== '') o.percent = Number(r.percent);
    if (r.mode === 'formula' && r.formula.trim()) o.formula = r.formula.trim();
    if (Object.keys(o).length) out[r.code] = o;
  }
  return out;
}

export function PayslipLines({ lines, totals, currencyMoney }: { lines: Line[]; totals: { earnings: number; deductions: number; reimbursements: number; employerContributions: number; net: number }; currencyMoney: (n: number | string) => string }) {
  const group = (cat: Line['category']) => lines.filter(l => l.category === cat);
  const Section = ({ title, cat, sign }: { title: string; cat: Line['category']; sign?: string }) => {
    const ls = group(cat); if (!ls.length) return null;
    return (
      <>
        <p className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mt-2">{title}</p>
        {ls.map(l => (
          <div key={l.code} className="contents">
            <p className="text-fg-muted flex items-center gap-1.5">{l.name}{l.adjusted && <Badge variant="yellow">adjusted</Badge>}<span className="text-[10px] text-fg-subtle hidden sm:inline">{l.basis}</span></p>
            <p className={`text-right tabular-nums ${cat === 'DEDUCTION' ? 'text-danger' : 'text-fg'}`}>{sign}{currencyMoney(l.amount)}</p>
          </div>
        ))}
      </>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
      <Section title="Earnings" cat="EARNING" />
      <p className="font-medium text-fg border-t border-line-subtle pt-2">Gross earnings</p><p className="text-right font-medium text-fg border-t border-line-subtle pt-2 tabular-nums">{currencyMoney(totals.earnings)}</p>
      <Section title="Reimbursements" cat="REIMBURSEMENT" />
      <Section title="Deductions" cat="DEDUCTION" sign="−" />
      <p className="font-medium text-fg border-t border-line-subtle pt-2">Total deductions</p><p className="text-right font-medium text-danger border-t border-line-subtle pt-2 tabular-nums">−{currencyMoney(totals.deductions)}</p>
      <p className="font-semibold text-fg border-t border-line pt-2">Net pay</p><p className="text-right font-semibold text-fg border-t border-line pt-2 tabular-nums">{currencyMoney(totals.net)}</p>
      {totals.employerContributions > 0 && (<><p className="text-fg-subtle text-xs mt-1">Employer contributions (not paid to employee)</p><p className="text-right text-fg-subtle text-xs mt-1 tabular-nums">{currencyMoney(totals.employerContributions)}</p></>)}
    </div>
  );
}

export function EmployeeSalariesSection() {
  const { money, date } = useFormat();
  const { data: salaries, isLoading } = useEmployeeSalaries();
  const { data: comps } = useSalaryComponents();
  const { data: cycles } = usePayrollCycles();
  const { data: users } = useUsers();
  const save = useSaveEmployeeSalary();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeSalary | null>(null);
  const [userId, setUserId] = useState('');
  const [cycleId, setCycleId] = useState('');
  const [ctc, setCtc] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [whatIfLop, setWhatIfLop] = useState('0');

  const components = comps?.components ?? [];
  const byCode = useMemo(() => new Map(components.map(c => [c.code, c])), [components]);

  const openCreate = () => {
    setEditing(null); setUserId(''); setCycleId(cycles?.find(c => c.isDefault)?.id ?? ''); setCtc(''); setNotes('');
    setEffectiveFrom(new Date().toISOString().slice(0, 10)); setRows(rowsFrom(components, {})); setError(''); setOpen(true);
  };
  const openEdit = (s: EmployeeSalary) => {
    setEditing(s); setUserId(s.userId); setCycleId(s.payrollCycleId ?? ''); setCtc(s.ctcAnnual ?? ''); setNotes(s.notes ?? '');
    setEffectiveFrom(new Date().toISOString().slice(0, 10)); setRows(rowsFrom(components, s.overrides ?? {})); setError(''); setOpen(true);
  };
  const setRow = (code: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.code === code ? { ...r, ...patch } : r)));

  const overrides = useMemo(() => overridesFrom(rows), [rows]);
  const previewBody = open ? { userId: userId || undefined, overrides, ctcAnnual: ctc === '' ? null : Number(ctc), payrollCycleId: cycleId || undefined, attendance: false, inputs: Number(whatIfLop) > 0 ? { lopDays: Number(whatIfLop) } : undefined } : null;
  const { data: preview, isFetching } = usePreview(previewBody);

  const submit = () => {
    if (!userId) { setError('Pick an employee'); return; }
    save.mutate({ userId, payrollCycleId: cycleId || null, ctcAnnual: ctc === '' ? null : Number(ctc), overrides, effectiveFrom, notes: notes || null },
      { onSuccess: () => setOpen(false), onError: (e: any) => setError(e?.response?.data?.error || 'Could not save') });
  };

  const employeeOptions = (users ?? []).filter((u: any) => u.isActive !== false).map((u: any) => ({ value: u.id, label: `${u.name} — ${u.email}` }));

  return (
    <Card>
      <CardHeader title="Employee Salaries" subtitle="Assign a payroll cycle and set each person's component values. Saving creates a new revision; past payslips keep the old one." icon={<Wallet size={14} />} className="mb-3"
        actions={<Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Set salary</Button>} />
      {isLoading ? <SkeletonTable rows={4} /> : !salaries?.length ? (
        <EmptyState compact icon={<Wallet />} title="No salaries set up" description="Set a salary for each employee to include them in payroll runs." action={{ label: 'Set salary', onClick: openCreate }} />
      ) : (
        <DataTable<EmployeeSalary>
          minWidth={560}
          rows={salaries}
          rowKey={s => s.id}
          columns={[
            { key: 'emp', header: 'Employee', cell: s => (
              <div className="flex items-center gap-2 min-w-0"><Avatar name={s.user.name} src={s.user.avatarUrl ?? undefined} size="sm" /><div className="min-w-0"><p className="text-sm font-medium text-fg truncate">{s.user.name}</p><p className="text-xs text-fg-subtle truncate">{s.user.department || s.user.email}</p></div></div>) },
            { key: 'cycle', header: 'Cycle', cell: s => <Badge variant="gray">{s.payrollCycle?.name ?? 'Default'}</Badge> },
            { key: 'basic', header: 'Basic', align: 'right', cell: s => <span className="tabular-nums">{s.overrides?.BASIC?.amount != null ? money(s.overrides.BASIC.amount) : '—'}</span> },
            { key: 'ctc', header: 'CTC / yr', align: 'right', hideBelow: 'sm', cell: s => <span className="tabular-nums text-fg-muted">{s.ctcAnnual ? money(s.ctcAnnual) : '—'}</span> },
            { key: 'from', header: 'Effective', hideBelow: 'md', cell: s => <span className="text-xs text-fg-subtle">{date(s.effectiveFrom)}</span> },
            { key: 'actions', header: '', align: 'right', cell: s => <IconButton label="Revise" icon={<Pencil size={13} />} onClick={() => openEdit(s)} /> },
          ]}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Revise salary — ${editing.user.name}` : 'Set employee salary'} icon={<Wallet size={16} />} size="xl"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{editing ? 'Save revision' : 'Save'}</Button></>}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)] gap-5">
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Employee" className="sm:col-span-2"><SearchableSelect value={userId} onChange={setUserId} options={employeeOptions} disabled={!!editing} ariaLabel="Employee" placeholder="Choose an employee" /></Field>
              <Field label="Payroll cycle"><Select value={cycleId} onChange={e => setCycleId(e.target.value)}>{(cycles ?? []).map(c => <option key={c.id} value={c.id}>{c.name} ({c.frequency.toLowerCase()})</option>)}</Select></Field>
              <Field label="Annual CTC (optional)" hint="For CTC-based formulas and display"><Input type="number" min={0} value={ctc} onChange={e => setCtc(e.target.value)} /></Field>
              <Field label="Effective from"><Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} /></Field>
              <Field label="Notes"><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Annual revision" /></Field>
            </div>

            <div className="rounded-card border border-line-subtle divide-y divide-line-subtle">
              {rows.map(r => {
                const c = byCode.get(r.code)!;
                const fixedDefault = c.calcType === 'FIXED' && !c.statutory;
                return (
                  <div key={r.code} className={`p-2.5 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-2 items-center ${r.enabled ? '' : 'opacity-50'}`}>
                    <div className="min-w-0">
                      <Checkbox label={<span className="text-[13px] font-medium">{c.name}</span>} checked={r.enabled} onChange={e => setRow(r.code, { enabled: e.target.checked })} />
                      <p className="text-[10.5px] text-fg-subtle ml-6">{CATEGORY_LABEL[c.category]} · {c.statutory ? 'statutory' : c.calcType === 'FIXED' ? 'fixed' : c.calcType === 'PERCENT' ? `${c.percent}% of ${c.percentOf}` : 'formula'}</p>
                    </div>
                    <Select value={r.mode} disabled={!r.enabled} onChange={e => setRow(r.code, { mode: e.target.value as Row['mode'] })}>
                      <option value="default">{fixedDefault && !c.amount ? 'Amount…' : 'Component default'}</option>
                      {c.statutory !== 'PF_EMP' && c.statutory !== 'PF_EMPLOYER' && c.statutory !== 'ESI_EMP' && c.statutory !== 'ESI_EMPLOYER' && c.statutory !== 'PT' && <option value="amount">Fixed amount</option>}
                      {c.calcType === 'PERCENT' && <option value="percent">Percent</option>}
                      {!c.statutory && <option value="formula">Formula</option>}
                    </Select>
                    <div>
                      {(r.mode === 'amount' || (r.mode === 'default' && fixedDefault && !c.amount)) && <Input type="number" min={0} placeholder="Amount" value={r.amount} disabled={!r.enabled} onChange={e => setRow(r.code, { amount: e.target.value, mode: 'amount' })} />}
                      {r.mode === 'percent' && <Input type="number" min={0} step="0.01" placeholder={`% of ${c.percentOf}`} value={r.percent} disabled={!r.enabled} onChange={e => setRow(r.code, { percent: e.target.value })} />}
                      {r.mode === 'formula' && <Input placeholder="e.g. BASIC * 0.1" value={r.formula} disabled={!r.enabled} onChange={e => setRow(r.code, { formula: e.target.value })} />}
                      {r.mode === 'default' && !(fixedDefault && !c.amount) && <span className="text-xs text-fg-subtle">uses component rule</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="lg:sticky lg:top-0 self-start">
            <Card tone="sunken" flat padding="sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-fg flex items-center gap-1.5"><Calculator size={13} /> Live preview{preview ? ` · ${preview.period.label}` : ''}</p>
                {isFetching && <span className="text-[11px] text-fg-subtle">recalculating…</span>}
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] text-fg-subtle">What if LOP days =</span>
                <Input type="number" min={0} className="w-20" value={whatIfLop} onChange={e => setWhatIfLop(e.target.value)} />
              </div>
              {preview ? (
                <>
                  <PayslipLines lines={preview.lines} totals={preview.totals} currencyMoney={money} />
                  {preview.warnings.length > 0 && <Alert tone="warning" className="mt-3">{preview.warnings.join(' · ')}</Alert>}
                  <p className="text-[10.5px] text-fg-subtle mt-3">{preview.inputs.paidDays}/{preview.inputs.workingDays} paid days · {preview.period.daysInPeriod}-day period</p>
                </>
              ) : <p className="text-xs text-fg-subtle">Pick an employee or enter amounts to see the payslip.</p>}
            </Card>
          </aside>
        </div>
      </Modal>
    </Card>
  );
}
