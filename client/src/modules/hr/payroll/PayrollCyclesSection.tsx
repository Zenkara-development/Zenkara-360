import { useState } from 'react';
import { CalendarClock, Plus, Pencil } from 'lucide-react';
import { Card, CardHeader, Button, Modal, Badge, Field, Input, Select, Checkbox, Alert, SkeletonTable, IconButton } from '../../../shared/components';
import { usePayrollCycles, useSaveCycle, type PayrollCycle, type Frequency } from '../../../api/payroll';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const empty = { name: '', frequency: 'MONTHLY' as Frequency, startWeekday: '1', anchorDate: '', lengthDays: '30', isDefault: false, isActive: true };

export function PayrollCyclesSection() {
  const { data, isLoading } = usePayrollCycles();
  const save = useSaveCycle();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollCycle | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const set = (k: keyof typeof empty, v: any) => setForm(f => ({ ...f, [k]: v }));

  const openCreate = () => { setEditing(null); setForm(empty); setError(''); setOpen(true); };
  const openEdit = (c: PayrollCycle) => {
    setEditing(c); setError(''); setOpen(true);
    setForm({ name: c.name, frequency: c.frequency, startWeekday: String(c.startWeekday ?? 1), anchorDate: c.anchorDate ? c.anchorDate.slice(0, 10) : '', lengthDays: String(c.lengthDays ?? 30), isDefault: c.isDefault, isActive: c.isActive });
  };
  const submit = () => save.mutate({
    id: editing?.id, name: form.name, frequency: form.frequency,
    startWeekday: form.frequency === 'WEEKLY' || form.frequency === 'BIWEEKLY' ? Number(form.startWeekday) : null,
    anchorDate: form.anchorDate || null, lengthDays: form.frequency === 'CUSTOM' ? Number(form.lengthDays) : null,
    isDefault: form.isDefault, isActive: form.isActive,
  } as any, { onSuccess: () => setOpen(false), onError: (e: any) => setError(e?.response?.data?.error || 'Could not save') });

  return (
    <Card>
      <CardHeader title="Payroll Cycles" subtitle="Weekly, bi-weekly, monthly or custom periods. Each employee is assigned to one cycle on their salary." icon={<CalendarClock size={14} />} className="mb-3"
        actions={<Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Add cycle</Button>} />
      {isLoading ? <SkeletonTable rows={2} /> : (
        <div className="space-y-2">
          {(data ?? []).map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3 p-3 border border-line-subtle rounded-card flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium text-fg">{c.name}</span><Badge variant="gray">{c.frequency.toLowerCase()}</Badge>{c.isDefault && <Badge variant="accent">default</Badge>}{!c.isActive && <Badge variant="red">inactive</Badge>}</div>
                <p className="text-xs text-fg-subtle mt-0.5">Current period {c.currentPeriod.label} · {c._count?.salaries ?? 0} employee{(c._count?.salaries ?? 0) === 1 ? '' : 's'}</p>
              </div>
              <IconButton label="Edit" icon={<Pencil size={13} />} onClick={() => openEdit(c)} />
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit cycle' : 'New payroll cycle'} icon={<CalendarClock size={16} />} size="sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}>
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Name"><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Weekly contractors" /></Field>
          <Field label="Frequency">
            <Select value={form.frequency} onChange={e => set('frequency', e.target.value as Frequency)}>
              <option value="MONTHLY">Monthly (calendar month)</option><option value="WEEKLY">Weekly</option><option value="BIWEEKLY">Bi-weekly</option><option value="CUSTOM">Custom (N days)</option>
            </Select>
          </Field>
          {(form.frequency === 'WEEKLY' || form.frequency === 'BIWEEKLY') && (
            <Field label="Week starts on"><Select value={form.startWeekday} onChange={e => set('startWeekday', e.target.value)}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          )}
          {form.frequency === 'BIWEEKLY' && <Field label="A known period start (anchor)" hint="Any date a bi-weekly period began — fixes which weeks pair up"><Input type="date" value={form.anchorDate} onChange={e => set('anchorDate', e.target.value)} /></Field>}
          {form.frequency === 'CUSTOM' && (<>
            <Field label="First period starts on"><Input type="date" value={form.anchorDate} onChange={e => set('anchorDate', e.target.value)} /></Field>
            <Field label="Period length (days)"><Input type="number" min={1} max={366} value={form.lengthDays} onChange={e => set('lengthDays', e.target.value)} /></Field>
          </>)}
          <Checkbox label="Default cycle for new salaries" checked={form.isDefault} onChange={e => set('isDefault', e.target.checked)} />
          <Checkbox label="Active" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
        </div>
      </Modal>
    </Card>
  );
}
