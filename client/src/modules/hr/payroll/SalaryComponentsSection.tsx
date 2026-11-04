import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Layers } from 'lucide-react';
import {
  Card, CardHeader, Button, Modal, Badge, EmptyState, Field, Input, Select, Textarea, Checkbox, Alert, SkeletonTable, IconButton, DataTable,
} from '../../../shared/components';
import { useDepartments, useLocations } from '../../../api/people';
import {
  useSalaryComponents, useSaveComponent, useDeleteComponent, useReorderComponents, CATEGORY_LABEL,
  type SalaryComponent, type Category, type CalcType,
} from '../../../api/payroll';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY'];

type Form = {
  code: string; name: string; category: Category; calcType: CalcType;
  amount: string; percent: string; percentOf: string; formula: string;
  statutory: string; statutoryConfig: Record<string, any>;
  prorate: boolean; taxable: boolean; showOnPayslip: boolean; isActive: boolean;
  departmentIds: string[]; locationIds: string[]; employmentTypes: string[]; designations: string;
};

const empty: Form = {
  code: '', name: '', category: 'EARNING', calcType: 'FIXED', amount: '', percent: '', percentOf: 'BASIC', formula: '',
  statutory: '', statutoryConfig: {}, prorate: true, taxable: true, showOnPayslip: true, isActive: true,
  departmentIds: [], locationIds: [], employmentTypes: [], designations: '',
};

function toForm(c: SalaryComponent): Form {
  return {
    code: c.code, name: c.name, category: c.category, calcType: c.calcType,
    amount: c.amount ?? '', percent: c.percent ?? '', percentOf: c.percentOf ?? 'BASIC', formula: c.formula ?? '',
    statutory: c.statutory ?? '', statutoryConfig: c.statutoryConfig ?? {},
    prorate: c.prorate, taxable: c.taxable, showOnPayslip: c.showOnPayslip, isActive: c.isActive,
    departmentIds: c.applicability?.departmentIds ?? [], locationIds: c.applicability?.locationIds ?? [],
    employmentTypes: c.applicability?.employmentTypes ?? [], designations: (c.applicability?.designations ?? []).join(', '),
  };
}

export function describeCalc(c: SalaryComponent): string {
  if (c.statutory) return `Statutory · ${c.statutory.replace(/_/g, ' ')}`;
  if (c.calcType === 'FIXED') return c.amount && Number(c.amount) > 0 ? `Fixed ${Number(c.amount).toLocaleString()}` : 'Fixed (per employee)';
  if (c.calcType === 'PERCENT') return `${Number(c.percent)}% of ${c.percentOf || 'BASIC'}`;
  return `Formula: ${c.formula}`;
}

export function SalaryComponentsSection() {
  const { data, isLoading } = useSalaryComponents();
  const save = useSaveComponent();
  const remove = useDeleteComponent();
  const reorder = useReorderComponents();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const [editing, setEditing] = useState<SalaryComponent | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const components = (data?.components ?? []).filter(c => showInactive || c.isActive);
  const presets = data?.statutoryPresets ?? {};
  const codes = (data?.components ?? []).map(c => c.code);

  const openCreate = () => { setEditing(null); setForm(empty); setError(''); setOpen(true); };
  const openEdit = (c: SalaryComponent) => { setEditing(c); setForm(toForm(c)); setError(''); setOpen(true); };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    // Picking a statutory preset fills category/name/config defaults
    if (form.statutory && presets[form.statutory] && !editing) {
      const p = presets[form.statutory];
      setForm(f => ({ ...f, name: f.name || p.name, category: p.category, calcType: 'FORMULA', statutoryConfig: { ...p.defaults, ...f.statutoryConfig }, code: f.code || form.statutory }));
    }
  }, [form.statutory]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    setError('');
    const applicability = {
      departmentIds: form.departmentIds, locationIds: form.locationIds, employmentTypes: form.employmentTypes,
      designations: form.designations.split(',').map(s => s.trim()).filter(Boolean),
    };
    const noScope = !applicability.departmentIds.length && !applicability.locationIds.length && !applicability.employmentTypes.length && !applicability.designations.length;
    save.mutate({
      id: editing?.id,
      code: form.code.trim().toUpperCase(), name: form.name.trim(), category: form.category,
      calcType: form.statutory ? 'FORMULA' : form.calcType,
      amount: form.calcType === 'FIXED' || form.statutory === 'TDS' ? (form.amount === '' ? null : Number(form.amount)) as any : null,
      percent: form.calcType === 'PERCENT' ? (form.percent === '' ? null : Number(form.percent)) as any : null,
      percentOf: form.calcType === 'PERCENT' ? form.percentOf : null,
      formula: form.calcType === 'FORMULA' && !form.statutory ? form.formula : null,
      statutory: form.statutory || null, statutoryConfig: form.statutory ? form.statutoryConfig : undefined,
      prorate: form.prorate, taxable: form.taxable, showOnPayslip: form.showOnPayslip, isActive: form.isActive,
      applicability: noScope ? null : applicability,
    }, { onSuccess: () => setOpen(false), onError: (e: any) => setError(e?.response?.data?.error || e?.response?.data?.details?.[0]?.message || 'Could not save') });
  };

  const move = (idx: number, dir: -1 | 1) => {
    const order = components.map(c => c.id);
    const j = idx + dir; if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    reorder.mutate(order);
  };

  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const cfg = form.statutoryConfig;
  const setCfg = (k: string, v: any) => set('statutoryConfig', { ...cfg, [k]: v });

  return (
    <Card>
      <CardHeader
        title="Salary Components"
        subtitle="Every earning, deduction, reimbursement and employer contribution your payslips can show. Employees get values per component; formulas may reference other components by code."
        icon={<Layers size={14} />}
        className="mb-3"
        actions={<div className="flex items-center gap-2"><Checkbox label="Show inactive" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /><Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Add component</Button></div>}
      />
      {isLoading ? <SkeletonTable rows={6} /> : components.length === 0 ? (
        <EmptyState compact icon={<Layers />} title="No components yet" action={{ label: 'Add component', onClick: openCreate }} />
      ) : (
        <DataTable<SalaryComponent>
          minWidth={640}
          rows={components}
          rowKey={c => c.id}
          columns={[
            { key: 'order', header: '', cell: c => { const i = components.indexOf(c); return (
              <span className="inline-flex flex-col">
                <IconButton label="Move up" icon={<ArrowUp size={11} />} onClick={() => move(i, -1)} />
                <IconButton label="Move down" icon={<ArrowDown size={11} />} onClick={() => move(i, 1)} />
              </span>); } },
            { key: 'name', header: 'Component', cell: c => (
              <div className="min-w-0">
                <p className={`text-sm font-medium truncate ${c.isActive ? 'text-fg' : 'text-fg-subtle line-through'}`}>{c.name}</p>
                <p className="text-[11px] font-mono text-fg-subtle">{c.code}</p>
              </div>) },
            { key: 'category', header: 'Type', cell: c => <Badge variant={c.category === 'EARNING' ? 'green' : c.category === 'DEDUCTION' ? 'red' : c.category === 'REIMBURSEMENT' ? 'blue' : 'gray'}>{CATEGORY_LABEL[c.category]}</Badge> },
            { key: 'calc', header: 'Calculation', hideBelow: 'sm', cell: c => <span className="text-xs text-fg-muted">{describeCalc(c)}</span> },
            { key: 'flags', header: 'Applies to', hideBelow: 'md', cell: c => {
              const a = c.applicability; const parts: string[] = [];
              if (a?.departmentIds?.length) parts.push(`${a.departmentIds.length} dept`);
              if (a?.locationIds?.length) parts.push(`${a.locationIds.length} location`);
              if (a?.employmentTypes?.length) parts.push(a.employmentTypes.map(t => t.toLowerCase().replace('_', ' ')).join('/'));
              if (a?.designations?.length) parts.push(a.designations.join('/'));
              return <span className="text-xs text-fg-subtle">{parts.length ? parts.join(' · ') : 'Everyone'}{c.showOnPayslip ? '' : ' · hidden'}{c.prorate && c.category === 'EARNING' ? ' · prorated' : ''}</span>; } },
            { key: 'actions', header: '', align: 'right', cell: c => (
              <span className="inline-flex gap-1">
                <IconButton label="Edit" icon={<Pencil size={13} />} onClick={() => openEdit(c)} />
                {c.isActive && <IconButton label="Deactivate" tone="danger" icon={<Trash2 size={13} />} onClick={() => remove.mutate(c.id)} />}
              </span>) },
          ]}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.name}` : 'New salary component'} icon={<Layers size={16} />} size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Code" hint="Used in formulas; cannot change later"><Input value={form.code} disabled={!!editing} onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="e.g. SPECIAL_ALLOW" /></Field>
            <Field label="Name" className="sm:col-span-2"><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Shown on the payslip" /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Category">
              <Select value={form.category} onChange={e => set('category', e.target.value as Category)} disabled={!!form.statutory}>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map(k => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="Statutory preset" hint="India: PF, ESI, PT, TDS — rates editable below">
              <Select value={form.statutory} onChange={e => set('statutory', e.target.value)} disabled={!!editing}>
                <option value="">None (custom)</option>
                {Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
              </Select>
            </Field>
            {!form.statutory && (
              <Field label="Calculation">
                <Select value={form.calcType} onChange={e => set('calcType', e.target.value as CalcType)}>
                  <option value="FIXED">Fixed amount</option>
                  <option value="PERCENT">Percentage of…</option>
                  <option value="FORMULA">Formula</option>
                </Select>
              </Field>
            )}
          </div>

          {form.statutory && presets[form.statutory] && (
            <div className="rounded-card border border-line-subtle p-3 space-y-3 bg-surface-sunken">
              <p className="text-xs text-fg-muted">{presets[form.statutory].description}</p>
              {form.statutory.startsWith('PF') && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Rate %"><Input type="number" step="0.01" value={cfg.rate ?? ''} onChange={e => setCfg('rate', Number(e.target.value))} /></Field>
                  <Field label="Wage ceiling (monthly)"><Input type="number" value={cfg.wageCeiling ?? ''} onChange={e => setCfg('wageCeiling', Number(e.target.value))} /></Field>
                  <Field label="Base component"><Input value={cfg.base ?? 'BASIC'} onChange={e => setCfg('base', e.target.value.toUpperCase())} /></Field>
                  <Checkbox label="Compute on full basic (ignore ceiling)" checked={!!cfg.onFullBasic} onChange={e => setCfg('onFullBasic', e.target.checked)} />
                </div>
              )}
              {form.statutory.startsWith('ESI') && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Rate % of gross"><Input type="number" step="0.01" value={cfg.rate ?? ''} onChange={e => setCfg('rate', Number(e.target.value))} /></Field>
                  <Field label="Eligibility threshold (monthly gross ≤)"><Input type="number" value={cfg.threshold ?? ''} onChange={e => setCfg('threshold', Number(e.target.value))} /></Field>
                </div>
              )}
              {form.statutory === 'PT' && (
                <Field label="Monthly slabs (gross up to → amount)" hint="Last slab: leave 'up to' empty for 'and above'. Per-state slabs can be added via stateSlabs in the API.">
                  <div className="space-y-2">
                    {(cfg.slabs ?? []).map((s: any, i: number) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <Input type="number" placeholder="Up to" value={s.upTo ?? ''} onChange={e => setCfg('slabs', cfg.slabs.map((x: any, j: number) => j === i ? { ...x, upTo: e.target.value === '' ? null : Number(e.target.value) } : x))} />
                        <Input type="number" placeholder="Amount" value={s.amount ?? ''} onChange={e => setCfg('slabs', cfg.slabs.map((x: any, j: number) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
                        <Button size="xs" variant="ghost" onClick={() => setCfg('slabs', cfg.slabs.filter((_: any, j: number) => j !== i))}>Remove</Button>
                      </div>
                    ))}
                    <Button size="xs" variant="secondary" onClick={() => setCfg('slabs', [...(cfg.slabs ?? []), { upTo: null, amount: 0 }])}>Add slab</Button>
                  </div>
                </Field>
              )}
              {form.statutory === 'TDS' && <p className="text-xs text-fg-subtle">TDS is entered per employee (as an amount override on their salary).</p>}
            </div>
          )}

          {!form.statutory && form.calcType === 'FIXED' && (
            <Field label="Default amount per period" hint="Leave blank if it is always set per employee"><Input type="number" min={0} value={form.amount} onChange={e => set('amount', e.target.value)} /></Field>
          )}
          {!form.statutory && form.calcType === 'PERCENT' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Percent"><Input type="number" min={0} step="0.01" value={form.percent} onChange={e => set('percent', e.target.value)} /></Field>
              <Field label="Of">
                <Select value={form.percentOf} onChange={e => set('percentOf', e.target.value)}>
                  <option value="BASIC">BASIC</option>
                  <option value="GROSS_EARNINGS">Gross earnings</option>
                  <option value="CTC_MONTHLY">CTC (monthly)</option>
                  {codes.filter(c => c !== 'BASIC' && c !== form.code).map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {!form.statutory && form.calcType === 'FORMULA' && (
            <Field label="Formula" hint={`Use component codes and variables: ${(data?.variables ?? []).join(', ')}. Functions: min, max, round, floor, ceil, abs, if(cond, a, b).`}>
              <Textarea rows={2} value={form.formula} onChange={e => set('formula', e.target.value)} placeholder="e.g. min(BASIC * 0.12, 1800)" />
            </Field>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Checkbox label="Prorate by paid days" checked={form.prorate} onChange={e => set('prorate', e.target.checked)} />
            <Checkbox label="Taxable" checked={form.taxable} onChange={e => set('taxable', e.target.checked)} />
            <Checkbox label="Show on payslip" checked={form.showOnPayslip} onChange={e => set('showOnPayslip', e.target.checked)} />
            <Checkbox label="Active" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
          </div>

          <div className="rounded-card border border-line-subtle p-3 space-y-3">
            <p className="text-xs font-medium text-fg-muted">Applies to (leave everything unticked for everyone)</p>
            {!!departments?.data?.length && (
              <div>
                <p className="text-[11px] text-fg-subtle mb-1">Departments</p>
                <div className="flex flex-wrap gap-1.5">{departments.data.map(d => <Button key={d.id} size="xs" variant={form.departmentIds.includes(d.id) ? 'primary' : 'secondary'} onClick={() => set('departmentIds', toggleIn(form.departmentIds, d.id))}>{d.name}</Button>)}</div>
              </div>
            )}
            {!!locations?.data?.length && (
              <div>
                <p className="text-[11px] text-fg-subtle mb-1">Locations / branches</p>
                <div className="flex flex-wrap gap-1.5">{locations.data.map(l => <Button key={l.id} size="xs" variant={form.locationIds.includes(l.id) ? 'primary' : 'secondary'} onClick={() => set('locationIds', toggleIn(form.locationIds, l.id))}>{l.name}</Button>)}</div>
              </div>
            )}
            <div>
              <p className="text-[11px] text-fg-subtle mb-1">Employment type</p>
              <div className="flex flex-wrap gap-1.5">{EMPLOYMENT_TYPES.map(t => <Button key={t} size="xs" variant={form.employmentTypes.includes(t) ? 'primary' : 'secondary'} onClick={() => set('employmentTypes', toggleIn(form.employmentTypes, t))}>{t.toLowerCase().replace('_', ' ')}</Button>)}</div>
            </div>
            <Field label="Designations (comma-separated)"><Input value={form.designations} onChange={e => set('designations', e.target.value)} placeholder="e.g. Sales Executive, Area Manager" /></Field>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
