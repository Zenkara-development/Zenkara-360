import { useEffect, useMemo, useState } from 'react';
import { Palette, Plus, Pencil, Copy, Trash2, Star, Eye, FileDown } from 'lucide-react';
import {
  Card, CardHeader, Button, Modal, Badge, Field, Input, Textarea, Checkbox, Alert, SkeletonTable, IconButton, EmptyState, Label,
} from '../../../shared/components';
import { useDepartments, useLocations } from '../../../api/people';
import {
  usePayslipTemplates, useSaveTemplate, useDeleteTemplate, useDuplicateTemplate, useTemplatePreview, downloadPdf,
  type PayslipTemplate, type TemplateInput, type LayoutKey,
} from '../../../api/payslipTemplates';
import { useDebounce } from '../../../hooks/useDebounce';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY'];
const human = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

type Nullable = 'companyName' | 'companyAddress' | 'logoUrl' | 'accentColor' | 'headerNote' | 'footerNote' | 'signatoryName' | 'signatureUrl';
type Form = Omit<TemplateInput, 'showFields' | 'applicability' | Nullable> & Record<Nullable, string> & { showFields: Record<string, boolean>; departmentIds: string[]; locationIds: string[]; employmentTypes: string[] };

const emptyForm = (layout: LayoutKey = 'STANDARD'): Form => ({
  name: '', layout, isDefault: false, isActive: true, companyName: '', companyAddress: '', logoUrl: '', primaryColor: '#2563eb', accentColor: '',
  headerTitle: 'Payslip', headerNote: '', footerNote: '', showSignature: true, signatureLabel: 'Authorized Signatory', signatoryName: '', signatureUrl: '',
  showFields: {}, departmentIds: [], locationIds: [], employmentTypes: [],
});
const fromTemplate = (t: PayslipTemplate): Form => ({
  name: t.name, layout: t.layout, isDefault: t.isDefault, isActive: t.isActive, companyName: t.companyName ?? '', companyAddress: t.companyAddress ?? '', logoUrl: t.logoUrl ?? '',
  primaryColor: t.primaryColor, accentColor: t.accentColor ?? '', headerTitle: t.headerTitle, headerNote: t.headerNote ?? '', footerNote: t.footerNote ?? '',
  showSignature: t.showSignature, signatureLabel: t.signatureLabel, signatoryName: t.signatoryName ?? '', signatureUrl: t.signatureUrl ?? '',
  showFields: t.showFields ?? {}, departmentIds: t.applicability?.departmentIds ?? [], locationIds: t.applicability?.locationIds ?? [], employmentTypes: t.applicability?.employmentTypes ?? [],
});
const toPayload = (f: Form): Partial<TemplateInput> => {
  const { departmentIds, locationIds, employmentTypes, ...rest } = f;
  return { ...rest, applicability: { departmentIds, locationIds, employmentTypes } };
};

export function PayslipTemplatesSection() {
  const { data, isLoading } = usePayslipTemplates();
  const save = useSaveTemplate();
  const remove = useDeleteTemplate();
  const duplicate = useDuplicateTemplate();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const [editing, setEditing] = useState<PayslipTemplate | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  const deptName = (id: string) => departments?.data?.find(d => d.id === id)?.name ?? id;
  const locName = (id: string) => locations?.data?.find(l => l.id === id)?.name ?? id;
  const layoutName = (k: string) => data?.layouts.find(l => l.key === k)?.name ?? k;

  return (
    <Card>
      <CardHeader
        title="Payslip templates" icon={<Palette size={14} />} className="mb-3"
        subtitle="Design one or more layouts. The default applies to everyone; other templates apply to the departments, locations or employment types you assign."
        actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New template</Button>}
      />
      {notice && <Alert tone="info" className="mb-3" onDismiss={() => setNotice('')}>{notice}</Alert>}
      {isLoading || !data ? <SkeletonTable rows={3} /> : data.templates.length === 0 ? (
        <EmptyState compact icon={<Palette />} title="No templates yet" action={{ label: 'Create one', onClick: () => setEditing('new') }} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.templates.map(t => (
            <div key={t.id} className={`rounded-lg border p-3 ${t.isActive ? 'border-line-subtle' : 'border-dashed border-line opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.primaryColor }} />
                    <span className="font-medium text-fg truncate">{t.name}</span>
                    {t.isDefault && <Badge variant="accent">Default</Badge>}
                    {!t.isActive && <Badge variant="gray">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-fg-subtle mt-0.5">{layoutName(t.layout)} layout · {t.payslipCount ?? 0} payslip{t.payslipCount === 1 ? '' : 's'} issued</p>
                  {!t.isDefault && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(t.applicability?.departmentIds ?? []).map(id => <Badge key={id} variant="blue">{deptName(id)}</Badge>)}
                      {(t.applicability?.locationIds ?? []).map(id => <Badge key={id} variant="teal">{locName(id)}</Badge>)}
                      {(t.applicability?.employmentTypes ?? []).map(x => <Badge key={x} variant="purple">{human(x)}</Badge>)}
                      {!(t.applicability?.departmentIds?.length || t.applicability?.locationIds?.length || t.applicability?.employmentTypes?.length) && <span className="text-[11px] text-fg-subtle">Not assigned to anyone — set who it applies to</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center shrink-0">
                  {!t.isDefault && t.isActive && <IconButton label="Make default" icon={<Star size={14} />} onClick={() => save.mutate({ id: t.id, isDefault: true })} />}
                  <IconButton label="Preview PDF" icon={<FileDown size={14} />} onClick={() => downloadPdf(`/hr/payroll/templates/${t.id}/preview?format=pdf`, `${t.name}-sample.pdf`, true)} />
                  <IconButton label="Duplicate" icon={<Copy size={14} />} onClick={() => duplicate.mutate(t.id)} />
                  <IconButton label="Edit" icon={<Pencil size={14} />} onClick={() => setEditing(t)} />
                  {!t.isDefault && <IconButton label="Delete" tone="danger" icon={<Trash2 size={14} />} onClick={() => { if (confirm(`Delete "${t.name}"?`)) remove.mutate(t.id, { onSuccess: (r: any) => r?.deactivated && setNotice(r.message) }); }} />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && data && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          layouts={data.layouts} fields={data.fields}
          departments={departments?.data ?? []} locations={locations?.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function TemplateEditor({ template, layouts, fields, departments, locations, onClose }: {
  template: PayslipTemplate | null; layouts: { key: LayoutKey; name: string; description: string; defaults: Record<string, boolean> }[];
  fields: { key: string; label: string; group: string; default: boolean }[]; departments: { id: string; name: string }[]; locations: { id: string; name: string }[]; onClose: () => void;
}) {
  const save = useSaveTemplate();
  const [form, setForm] = useState<Form>(template ? fromTemplate(template) : emptyForm());
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'design' | 'fields' | 'assign'>('design');
  const debounced = useDebounce(form, 400);
  const previewBody = useMemo(() => toPayload(debounced), [debounced]);
  const { data: preview, isFetching } = useTemplatePreview(previewBody);
  const layout = layouts.find(l => l.key === form.layout);
  const fieldValue = (k: string) => (typeof form.showFields[k] === 'boolean' ? form.showFields[k] : (layout?.defaults[k] ?? fields.find(f => f.key === k)?.default ?? false));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (k: 'departmentIds' | 'locationIds' | 'employmentTypes', id: string) => setForm(f => ({ ...f, [k]: f[k].includes(id) ? f[k].filter(x => x !== id) : [...f[k], id] }));
  useEffect(() => { setError(''); }, [tab]);

  const submit = () => {
    if (!form.name.trim()) { setError('Give the template a name'); setTab('design'); return; }
    save.mutate({ id: template?.id, ...toPayload(form) }, { onSuccess: onClose, onError: (e: any) => setError(e?.response?.data?.error || 'Could not save template') });
  };

  return (
    <Modal open onClose={onClose} title={template ? `Edit template · ${template.name}` : 'New payslip template'} icon={<Palette size={16} />} size="xl"
      footer={<>
        <Button variant="ghost" icon={<Eye size={13} />} onClick={() => downloadPdf(`/hr/payroll/templates/${template?.id ?? ''}/preview?format=pdf`, 'sample.pdf', true)} disabled={!template}>Open sample PDF</Button>
        <span className="mr-auto" />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={submit}>{template ? 'Save changes' : 'Create template'}</Button>
      </>}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-5">
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex gap-1 border-b border-line-subtle">
            {(['design', 'fields', 'assign'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${tab === t ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg'}`}>
                {t === 'design' ? 'Design' : t === 'fields' ? 'Fields' : 'Applies to'}
              </button>
            ))}
          </div>

          {tab === 'design' && (
            <div className="space-y-4">
              <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                <Field label="Template name"><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Head office, Contractors" /></Field>
                <Checkbox label="Default" checked={form.isDefault} disabled={template?.isDefault} onChange={e => set('isDefault', e.target.checked)} />
              </div>
              <Field label="Layout">
                <div className="grid grid-cols-2 gap-2">
                  {layouts.map(l => (
                    <button key={l.key} type="button" onClick={() => set('layout', l.key)} className={`text-left rounded-lg border p-2.5 transition ${form.layout === l.key ? 'border-accent ring-1 ring-accent bg-accent-soft/40' : 'border-line-subtle hover:border-line-strong'}`}>
                      <LayoutThumb layout={l.key} color={form.primaryColor} />
                      <div className="text-xs font-medium text-fg mt-1.5">{l.name}</div>
                      <div className="text-[10.5px] text-fg-subtle leading-snug">{l.description}</div>
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary colour"><div className="flex items-center gap-2"><input type="color" value={form.primaryColor} onChange={e => set('primaryColor', e.target.value)} className="w-9 h-9 rounded-input border border-line cursor-pointer shrink-0" /><Input value={form.primaryColor} onChange={e => set('primaryColor', e.target.value)} /></div></Field>
                <Field label="Accent colour" hint="Section headings; blank = primary"><div className="flex items-center gap-2"><input type="color" value={form.accentColor || form.primaryColor} onChange={e => set('accentColor', e.target.value)} className="w-9 h-9 rounded-input border border-line cursor-pointer shrink-0" /><Input value={form.accentColor} onChange={e => set('accentColor', e.target.value)} placeholder="optional" /></div></Field>
              </div>
              <Field label="Company name"><Input value={form.companyName} onChange={e => set('companyName', e.target.value)} placeholder="Defaults to your org name" /></Field>
              <Field label="Company address"><Textarea rows={2} value={form.companyAddress} onChange={e => set('companyAddress', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Logo URL"><Input value={form.logoUrl} onChange={e => set('logoUrl', e.target.value)} placeholder="https://…" /></Field>
                <Field label="Document title"><Input value={form.headerTitle} onChange={e => set('headerTitle', e.target.value)} placeholder="Payslip" /></Field>
              </div>
              <Field label="Header note" hint="Printed under the letterhead, e.g. 'Confidential — for the employee only'"><Input value={form.headerNote} onChange={e => set('headerNote', e.target.value)} /></Field>
              <Field label="Footer note"><Textarea rows={2} value={form.footerNote} onChange={e => set('footerNote', e.target.value)} placeholder="This is a computer-generated document and does not require a signature." /></Field>
              <Checkbox label="Show a signature block" checked={form.showSignature} onChange={e => set('showSignature', e.target.checked)} />
              {form.showSignature && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Signatory name"><Input value={form.signatoryName} onChange={e => set('signatoryName', e.target.value)} placeholder="e.g. R. Menon" /></Field>
                  <Field label="Signature label"><Input value={form.signatureLabel} onChange={e => set('signatureLabel', e.target.value)} /></Field>
                  <Field label="Signature image URL" className="col-span-2"><Input value={form.signatureUrl} onChange={e => set('signatureUrl', e.target.value)} placeholder="https://… (PNG with transparent background)" /></Field>
                </div>
              )}
            </div>
          )}

          {tab === 'fields' && (
            <div className="space-y-4">
              <p className="text-xs text-fg-subtle">Unchecked items never print. Defaults follow the chosen layout; changing the layout keeps your explicit choices.</p>
              {(['Employee', 'Blocks'] as const).map(group => (
                <div key={group}>
                  <Label className="mb-1.5">{group === 'Employee' ? 'Employee details' : 'Sections'}</Label>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {fields.filter(f => f.group === group).map(f => (
                      <Checkbox key={f.key} label={f.label} checked={fieldValue(f.key)} onChange={e => setForm(x => ({ ...x, showFields: { ...x.showFields, [f.key]: e.target.checked } }))} />
                    ))}
                  </div>
                </div>
              ))}
              <Button size="xs" variant="ghost" onClick={() => set('showFields', {})}>Reset to layout defaults</Button>
            </div>
          )}

          {tab === 'assign' && (
            <div className="space-y-4">
              {form.isDefault ? <Alert tone="info">The default template applies to everyone who is not matched by another template.</Alert> : (
                <p className="text-xs text-fg-subtle">An employee gets this template when they match <strong>every</strong> group you pick below (a blank group means "any"). Leave everything blank to keep the template unassigned.</p>
              )}
              <Field label="Departments"><Chips items={departments.map(d => ({ id: d.id, label: d.name }))} selected={form.departmentIds} onToggle={id => toggle('departmentIds', id)} empty="No departments yet" /></Field>
              <Field label="Locations / branches"><Chips items={locations.map(l => ({ id: l.id, label: l.name }))} selected={form.locationIds} onToggle={id => toggle('locationIds', id)} empty="No locations yet" /></Field>
              <Field label="Employment types"><Chips items={EMPLOYMENT_TYPES.map(t => ({ id: t, label: human(t) }))} selected={form.employmentTypes} onToggle={id => toggle('employmentTypes', id)} /></Field>
              {template && !template.isDefault && <Checkbox label="Active (inactive templates are never applied to new payslips)" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <Label>Live preview{isFetching ? ' · updating…' : ''}</Label>
            <span className="text-[11px] text-fg-subtle">Sample data · the PDF uses the same layout</span>
          </div>
          <div className="rounded-lg border border-line-subtle bg-surface-sunken overflow-hidden" style={{ height: 620 }}>
            {preview ? <iframe title="Template preview" className="w-full h-full bg-white" sandbox="" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px;background:#f3f4f6;zoom:.82}</style></head><body>${preview.html}</body></html>`} /> : <div className="p-6 text-xs text-fg-subtle">Loading preview…</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Chips({ items, selected, onToggle, empty }: { items: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void; empty?: string }) {
  if (!items.length) return <p className="text-xs text-fg-subtle">{empty ?? 'Nothing to choose from'}</p>;
  return <div className="flex flex-wrap gap-1.5">{items.map(i => <Button key={i.id} size="xs" variant={selected.includes(i.id) ? 'primary' : 'secondary'} onClick={() => onToggle(i.id)}>{i.label}</Button>)}</div>;
}

/** Tiny schematic of each layout so the picker reads at a glance. */
function LayoutThumb({ layout, color }: { layout: LayoutKey; color: string }) {
  const band = layout === 'MODERN' || layout === 'BRANCH';
  const boxed = layout === 'CORPORATE' || layout === 'COMPACT' || layout === 'STATEMENT';
  const one = layout === 'STATEMENT';
  const mono = layout === 'MINIMAL';
  const c = mono ? '#6b7280' : color;
  return (
    <div className="w-full h-16 rounded bg-white border border-line-subtle p-1.5 flex flex-col gap-1" aria-hidden>
      <div className="h-3 rounded-sm" style={{ background: band ? c : 'transparent', borderBottom: band ? 'none' : `2px solid ${c}` }} />
      <div className="flex gap-1 flex-1">
        {one ? <div className="flex-1 rounded-sm" style={{ border: `1px solid ${boxed ? '#d1d5db' : 'transparent'}`, background: 'repeating-linear-gradient(#f3f4f6 0 2px, #fff 2px 5px)' }} /> : (
          <>
            <div className="flex-1 rounded-sm" style={{ border: `1px solid ${boxed ? '#d1d5db' : 'transparent'}`, background: 'repeating-linear-gradient(#f3f4f6 0 2px, #fff 2px 5px)' }} />
            <div className="flex-1 rounded-sm" style={{ border: `1px solid ${boxed ? '#d1d5db' : 'transparent'}`, background: 'repeating-linear-gradient(#f3f4f6 0 2px, #fff 2px 5px)' }} />
          </>
        )}
      </div>
      <div className="h-2 rounded-sm" style={{ background: band ? c : 'transparent', borderTop: band ? 'none' : `1px solid ${c}` }} />
    </div>
  );
}
