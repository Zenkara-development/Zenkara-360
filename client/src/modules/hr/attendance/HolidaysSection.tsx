import { useState } from 'react';
import { CalendarDays, Plus, Trash2, Pencil } from 'lucide-react';
import { Card, CardHeader, Button, Modal, Badge, Field, Input, Checkbox, Alert, SkeletonTable, IconButton, EmptyState } from '../../../shared/components';
import { useLocations } from '../../../api/people';
import { useHolidays, useSaveHoliday, useDeleteHoliday, type Holiday } from '../../../api/attendanceAdmin';
import { useFormat } from '../../../hooks/useFormat';

export function HolidaysSection() {
  const { date } = useFormat();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading } = useHolidays(year);
  const save = useSaveHoliday();
  const remove = useDeleteHoliday();
  const { data: locations } = useLocations();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [form, setForm] = useState({ date: '', name: '', locationIds: [] as string[], isOptional: false });
  const [error, setError] = useState('');
  const openCreate = () => { setEditing(null); setForm({ date: `${year}-01-01`, name: '', locationIds: [], isOptional: false }); setError(''); setOpen(true); };
  const openEdit = (h: Holiday) => { setEditing(h); setForm({ date: h.date.slice(0, 10), name: h.name, locationIds: h.locationIds, isOptional: h.isOptional }); setError(''); setOpen(true); };
  const submit = () => save.mutate({ id: editing?.id, ...form } as any, { onSuccess: () => setOpen(false), onError: (e: any) => setError(e?.response?.data?.error || 'Could not save') });
  const locName = (id: string) => locations?.data?.find(l => l.id === id)?.name ?? id;

  return (
    <Card>
      <CardHeader title="Holidays" subtitle="Paid holidays for the year; scope a holiday to specific branches or leave it for everyone." icon={<CalendarDays size={14} />} className="mb-3"
        actions={<div className="flex items-center gap-2"><Input type="number" className="w-24" value={year} onChange={e => setYear(Number(e.target.value) || year)} /><Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Add holiday</Button></div>} />
      {isLoading ? <SkeletonTable rows={3} /> : !data?.length ? <EmptyState compact icon={<CalendarDays />} title={`No holidays for ${year}`} action={{ label: 'Add holiday', onClick: openCreate }} /> : (
        <ul className="divide-y divide-line-subtle">
          {data.map(h => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0"><p className="text-sm text-fg">{h.name} {h.isOptional && <Badge variant="gray">optional</Badge>}</p><p className="text-xs text-fg-subtle tabular-nums">{date(h.date)}{h.locationIds.length ? ` · ${h.locationIds.map(locName).join(', ')}` : ' · all locations'}</p></div>
              <span className="inline-flex gap-1"><IconButton label="Edit" icon={<Pencil size={13} />} onClick={() => openEdit(h)} /><IconButton label="Delete" tone="danger" icon={<Trash2 size={13} />} onClick={() => remove.mutate(h.id)} /></span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit holiday' : 'Add holiday'} icon={<CalendarDays size={16} />} size="sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}>
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Date"><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Name"><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Diwali" /></Field>
          {!!locations?.data?.length && <Field label="Only these locations (none = all)"><div className="flex flex-wrap gap-1.5">{locations.data.map(l => <Button key={l.id} size="xs" variant={form.locationIds.includes(l.id) ? 'primary' : 'secondary'} onClick={() => setForm(f => ({ ...f, locationIds: f.locationIds.includes(l.id) ? f.locationIds.filter(x => x !== l.id) : [...f.locationIds, l.id] }))}>{l.name}</Button>)}</div></Field>}
          <Checkbox label="Optional / restricted holiday (employees may work; not a paid day off by default)" checked={form.isOptional} onChange={e => setForm(f => ({ ...f, isOptional: e.target.checked }))} />
        </div>
      </Modal>
    </Card>
  );
}
