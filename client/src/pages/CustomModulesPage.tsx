import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layers, Plus, Trash2, Pencil, RefreshCw, CheckCircle2, XCircle, Clock, Zap, Sparkles, FileEdit } from 'lucide-react';
import {
  useCustomModules, useCustomModule, useCreateCustomModule, useUpdateCustomModule, useDeleteCustomModule,
  useAddModuleField, useUpdateModuleField, useRemoveModuleField,
  useSyncConfig, useSaveSyncConfig, useTriggerSync, useModuleTemplates,
} from '../api/customModules';
import {
  PageHeader, PageBody, Button, Modal, EmptyState, SearchableSelect, RowActions,
  Card, Tabs, Field, Input, Textarea, Select, Checkbox, IconButton, FormGrid, FormActions,
  DataTable, Badge, Alert, AccessDenied, type Column,
} from '../shared/components';
import { CustomModuleRecordsTab } from '../shared/components/CustomModuleRecords';
import { STAGE_DOT } from '../shared/components/CustomModuleKanban';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'DROPDOWN', 'EMAIL', 'PHONE', 'URL', 'RELATION'];
const TYPE_LABELS: Record<string, string> = {
  TEXT: 'Text', TEXTAREA: 'Long Text', NUMBER: 'Number', CURRENCY: 'Currency', DATE: 'Date',
  BOOLEAN: 'Yes/No', DROPDOWN: 'Dropdown', EMAIL: 'Email', PHONE: 'Phone', URL: 'URL',
  RELATION: 'Relation (link to another module)',
};

/** Matches the server's STAGE_COLORS whitelist (customModules.controller.ts). */
const STAGE_COLORS = ['slate', 'blue', 'cyan', 'teal', 'emerald', 'amber', 'orange', 'rose', 'violet', 'indigo'];

// Matches AppLayout.tsx's NAV_SECTIONS labels exactly — kept as a small
// lookup here (rather than importing from AppLayout, a layout component
// with its own heavy nav/auth dependencies) since it's just display text for
// the picker.
const NAV_SECTION_OPTIONS = [
  { value: 'CRM', label: 'CRM' },
  { value: 'IT_DESK', label: 'IT Desk' },
  { value: 'HR', label: 'HR' },
  { value: 'ADMIN', label: 'Admin' },
];

const CREATE_DEFAULT = { name: '', icon: 'Layers', description: '', navSection: 'CRM', templateId: undefined as string | undefined };

/** One selectable starting-point tile in the create-module dialog. */
function TemplateChoice({ selected, icon, title, hint, onClick }: {
  selected: boolean; icon: React.ReactNode; title: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`text-left p-3 rounded-card border text-sm transition-colors ${
        selected ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-hover'
      }`}
    >
      <span className="flex items-center gap-1.5 font-medium text-fg">{icon} {title}</span>
      <span className="block text-xs text-fg-subtle mt-0.5">{hint}</span>
    </button>
  );
}

function CreateModuleModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateCustomModule();
  // This modal is mounted (closed) for the whole life of the page, and
  // GET /custom-modules/templates is CRM_MANAGERS-only while the module list
  // itself is ALL_STAFF — so an IT_MANAGER or agent opening the builder used to
  // fire a refused template lookup they never asked for. Without templates the
  // dialog simply offers "start from scratch".
  const { user } = useAuth();
  const { data: templates } = useModuleTemplates(can.readCrmReports(user?.role));
  const [form, setForm] = useState(CREATE_DEFAULT);

  function pickTemplate(t: any | null) {
    if (!t) { setForm(CREATE_DEFAULT); return; }
    setForm({ name: t.name, icon: t.icon, description: t.description, navSection: t.navSection, templateId: t.id });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await create.mutateAsync(form);
    setForm(CREATE_DEFAULT);
    onCreated(created.id);
  }

  return (
    <Modal open={open} onClose={() => { setForm(CREATE_DEFAULT); onClose(); }} title="New Custom Module">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Start from a template">
          <div className="grid grid-cols-2 gap-2">
            <TemplateChoice
              selected={!form.templateId}
              icon={<FileEdit size={14} />}
              title="Start from scratch"
              hint="Add your own fields afterward"
              onClick={() => pickTemplate(null)}
            />
            {(templates ?? []).map((t: any) => (
              <TemplateChoice
                key={t.id}
                selected={form.templateId === t.id}
                icon={<Sparkles size={14} />}
                title={t.name}
                hint={`${t.fieldCount} pre-built field${t.fieldCount === 1 ? '' : 's'}`}
                onClick={() => pickTemplate(t)}
              />
            ))}
          </div>
        </Field>
        <Field label="Module Name" required>
          <Input aria-label="Module Name" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Warranty Claims" />
        </Field>
        <Field label="Description">
          <Textarea aria-label="Description" rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What is this module for?" />
        </Field>
        <Field
          label="Sidebar section"
          hint="Which part of the sidebar this module's link appears under, once it has at least one field."
        >
          <Select aria-label="Sidebar section" value={form.navSection} onChange={e => setForm(p => ({ ...p, navSection: e.target.value }))}
            options={NAV_SECTION_OPTIONS} />
        </Field>
        {!form.templateId && (
          <p className="form-hint">You'll add fields to it on the next screen — nothing shows up for other users until you add at least one field.</p>
        )}
        <FormActions><Button type="submit" loading={create.isPending}>Create Module</Button></FormActions>
      </form>
    </Modal>
  );
}

function EditModuleModal({ module_, onClose }: { module_: any; onClose: () => void }) {
  const update = useUpdateCustomModule();
  const [form, setForm] = useState({ name: module_.name, description: module_.description ?? '', navSection: module_.navSection ?? 'CRM' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await update.mutateAsync({ id: module_.id, ...form });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Edit Module">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Module Name" required>
          <Input aria-label="Module Name" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Textarea aria-label="Description" rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        </Field>
        <Field label="Sidebar section">
          <Select aria-label="Sidebar section" value={form.navSection} onChange={e => setForm(p => ({ ...p, navSection: e.target.value }))}
            options={NAV_SECTION_OPTIONS} />
        </Field>
        <FormActions><Button type="submit" loading={update.isPending}>Save Changes</Button></FormActions>
      </form>
    </Modal>
  );
}

function FieldFormModal({ moduleId, field, onClose }: { moduleId: string; field: any | null; onClose: () => void }) {
  const add = useAddModuleField();
  const update = useUpdateModuleField();
  // For the RELATION target picker — every module in the org is a valid
  // target, including this one (parent/child records).
  const { data: allModules } = useCustomModules();
  // Relation target encoded as one picker value: "module:<id>" or "entity:<TYPE>".
  const initialTarget = field?.relationModuleId ? `module:${field.relationModuleId}`
    : field?.relationEntity ? `entity:${field.relationEntity}` : '';
  const [form, setForm] = useState(field
    ? { label: field.label, fieldType: field.fieldType, required: field.required, isPrimary: field.isPrimary, options: (field.options ?? []).join(', '), relationTarget: initialTarget }
    : { label: '', fieldType: 'TEXT', required: false, isPrimary: false, options: '', relationTarget: '' });
  const loading = add.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const [targetKind, targetVal] = form.relationTarget.split(':');
    const payload: any = {
      label: form.label,
      fieldType: form.fieldType,
      required: form.required,
      isPrimary: form.isPrimary,
      options: form.fieldType === 'DROPDOWN' ? form.options.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
      // Only meaningful on create — the server refuses retargeting an
      // existing relation field (records would hold dangling ids).
      ...(!field && form.fieldType === 'RELATION' && targetKind === 'module' ? { relationModuleId: targetVal } : {}),
      ...(!field && form.fieldType === 'RELATION' && targetKind === 'entity' ? { relationEntity: targetVal } : {}),
    };
    if (field) await update.mutateAsync({ moduleId, fieldId: field.id, ...payload });
    else await add.mutateAsync({ moduleId, ...payload });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={field ? 'Edit Field' : 'Add Field'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Label" required>
          <Input aria-label="Field Label" required value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Claim Amount" />
        </Field>
        <Field label="Type">
          <SearchableSelect ariaLabel="Field Type" value={form.fieldType} onChange={val => setForm(p => ({ ...p, fieldType: val }))} required options={FIELD_TYPES.map(t => ({ value: t, label: TYPE_LABELS[t] }))} />
        </Field>
        {form.fieldType === 'DROPDOWN' && (
          <Field label="Options" hint="Comma-separated">
            <Input aria-label="Dropdown Options" value={form.options} onChange={e => setForm(p => ({ ...p, options: e.target.value }))} placeholder="Option A, Option B, Option C" />
          </Field>
        )}
        {form.fieldType === 'RELATION' && (
          <Field
            label="Links to"
            hint={field ? 'The target of an existing relation field can’t be changed — delete and recreate the field to retarget it.' : 'Each record can link one record of the target — a core CRM/desk record, or another module. Linked core records show this record in their "Related records" panel.'}
          >
            <SearchableSelect
              ariaLabel="Relation target"
              value={form.relationTarget}
              onChange={val => setForm(p => ({ ...p, relationTarget: val }))}
              options={[
                { value: 'entity:CONTACT', label: 'Contacts (CRM)' },
                { value: 'entity:ACCOUNT', label: 'Accounts (CRM)' },
                { value: 'entity:DEAL',    label: 'Deals (CRM)' },
                { value: 'entity:TICKET',  label: 'Tickets (IT Desk)' },
                ...(allModules ?? []).map((m: any) => ({ value: `module:${m.id}`, label: `${m.name} (custom module)` })),
              ]}
              placeholder="Pick a target…"
              disabled={!!field}
            />
          </Field>
        )}
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Required" checked={form.required} onChange={e => setForm(p => ({ ...p, required: e.target.checked }))} />
          <Checkbox label="Use as record title" checked={form.isPrimary} onChange={e => setForm(p => ({ ...p, isPrimary: e.target.checked }))} />
        </div>
        <FormActions><Button type="submit" loading={loading}>{field ? 'Save Changes' : 'Add Field'}</Button></FormActions>
      </form>
    </Modal>
  );
}

function FieldsTab({ module_ }: { module_: any }) {
  const removeField = useRemoveModuleField();
  const [fieldModal, setFieldModal] = useState<null | 'new' | any>(null);
  const fields = module_.fields ?? [];

  const columns: Column<any>[] = [
    { key: 'label', header: 'Label', cell: f => <span className="font-medium text-fg">{f.label}</span> },
    { key: 'key', header: 'Key', cell: f => <code className="text-xs font-mono bg-surface-sunken text-fg px-1.5 py-0.5 rounded-badge" title={f.fieldKey}>{f.fieldKey}</code> },
    { key: 'type', header: 'Type', cell: f => <Badge variant="blue">{TYPE_LABELS[f.fieldType] ?? f.fieldType}</Badge> },
    {
      key: 'required', header: 'Required',
      cell: f => f.required ? <span className="text-success font-medium">Yes</span> : <span className="text-fg-subtle">No</span>,
    },
    {
      key: 'primary', header: 'Title Field',
      cell: f => f.isPrimary ? <CheckCircle2 size={14} className="text-accent" /> : <span className="text-fg-subtle">—</span>,
    },
    {
      key: 'actions', header: '', width: 56,
      cell: f => (
        <RowActions items={[
          { label: 'Edit field', icon: <Pencil size={14} />, onClick: () => setFieldModal(f) },
          { label: 'Delete field', icon: <Trash2 size={14} />, onClick: () => { if (confirm('Delete this field? Existing record data for it is kept but hidden.')) removeField.mutate({ moduleId: module_.id, fieldId: f.id }); }, variant: 'danger' },
        ]} />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus size={13} />} onClick={() => setFieldModal('new')}>Add Field</Button>
      </div>
      <DataTable
        columns={columns}
        rows={fields}
        rowKey={(f: any) => f.id}
        minWidth={560}
        empty={<EmptyState compact icon={<Layers size={22} />} title="No fields yet" description="Add fields to define this module's shape." action={{ label: 'Add Field', onClick: () => setFieldModal('new') }} />}
      />
      {fieldModal && <FieldFormModal moduleId={module_.id} field={fieldModal === 'new' ? null : fieldModal} onClose={() => setFieldModal(null)} />}
    </div>
  );
}

/**
 * PipelineTab (Phase 2) — define the module's stages (turning its records
 * page into a kanban board) and pick which fields show as list columns.
 * Stage keys are derived from the label once and then kept stable, so
 * renaming "In Stock" to "Available" doesn't orphan records already sitting
 * in that column.
 */
function PipelineTab({ module_ }: { module_: any }) {
  const update = useUpdateCustomModule();
  const [stages, setStages] = useState<{ key: string; label: string; color: string }[]>(
    Array.isArray(module_.stages) ? module_.stages.map((s: any) => ({ color: 'slate', ...s })) : [],
  );
  const [listColumns, setListColumns] = useState<string[]>(Array.isArray(module_.listColumns) ? module_.listColumns : []);
  const [saved, setSaved] = useState(false);
  const fields = module_.fields ?? [];

  function addStage() {
    setStages(s => [...s, { key: '', label: '', color: STAGE_COLORS[s.length % STAGE_COLORS.length] }]);
  }
  function setStage(i: number, patch: Partial<{ label: string; color: string }>) {
    setStages(s => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));
  }
  function move(i: number, dir: -1 | 1) {
    setStages(s => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function toggleColumn(fieldKey: string) {
    setListColumns(cols => cols.includes(fieldKey) ? cols.filter(c => c !== fieldKey) : [...cols, fieldKey]);
  }

  async function save() {
    const slugKey = (label: string, i: number) =>
      label.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '') || `stage-${i + 1}`;
    const seen = new Set<string>();
    const clean = stages
      .filter(s => s.label.trim())
      .map((s, i) => {
        let key = s.key || slugKey(s.label, i);
        while (seen.has(key)) key = `${key}-2`;
        seen.add(key);
        return { key, label: s.label.trim(), color: s.color };
      });
    await update.mutateAsync({
      id: module_.id,
      stages: clean.length ? clean : null,
      listColumns: listColumns.length ? listColumns : null,
    });
    setStages(clean);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5">
      <Alert tone="info" icon={null}>
        Give this module stages and its records page gains a drag-and-drop board — moves between stages can
        trigger automations (trigger: <code className="text-xs">CUSTOM_RECORD_STAGE_CHANGED</code>).
        Leave the list empty for a plain table module.
      </Alert>

      <div className="form-section">
        <p className="form-section-title">Pipeline stages</p>
        <div className="space-y-2">
          {stages.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STAGE_DOT[s.color] ?? 'bg-slate-400'}`} aria-hidden />
              <Input
                aria-label={`Stage ${i + 1} name`}
                value={s.label}
                onChange={e => setStage(i, { label: e.target.value })}
                placeholder={`Stage ${i + 1} (e.g. In Stock)`}
                className="flex-1"
              />
              <SearchableSelect
                ariaLabel={`Stage ${i + 1} color`}
                value={s.color}
                onChange={val => setStage(i, { color: val })}
                options={STAGE_COLORS.map(c => ({ value: c, label: c }))}
                className="w-28"
              />
              <IconButton label="Move up" icon={<span className="text-xs">↑</span>} onClick={() => move(i, -1)} />
              <IconButton label="Move down" icon={<span className="text-xs">↓</span>} onClick={() => move(i, 1)} />
              <IconButton label="Remove stage" tone="danger" icon={<Trash2 size={14} />} onClick={() => setStages(st => st.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={addStage} disabled={stages.length >= 12}>
            Add stage
          </Button>
        </div>
      </div>

      <div className="form-section">
        <p className="form-section-title">List columns</p>
        <p className="form-hint mb-2 mt-0">Which fields show as table columns (in the order you pick them). None selected = first five fields.</p>
        <div className="flex flex-wrap gap-1.5">
          {fields.map((f: any) => {
            const idx = listColumns.indexOf(f.fieldKey);
            const on = idx >= 0;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleColumn(f.fieldKey)}
                className={`px-2.5 py-1 rounded-btn border text-[12px] transition-colors ${
                  on ? 'border-accent bg-accent-soft text-accent-soft-fg font-medium' : 'border-line text-fg-muted hover:bg-surface-hover'
                }`}
              >
                {on && <span className="mr-1 tabular-nums">{idx + 1}.</span>}{f.label}
              </button>
            );
          })}
          {!fields.length && <p className="text-[12.5px] text-fg-subtle">Add fields first.</p>}
        </div>
      </div>

      <FormActions>
        {saved && <span className="flex items-center gap-1 text-[12.5px] font-medium text-success"><CheckCircle2 size={14} /> Saved</span>}
        <Button onClick={save} loading={update.isPending}>Save pipeline</Button>
      </FormActions>
    </div>
  );
}

function SyncTab({ module_ }: { module_: any }) {
  const { dateTime } = useFormat();
  // /custom-modules/:id/sync is CRM_MANAGERS-only. The tab that mounts this is
  // hidden for everyone else, but keep the capability on the query too so the
  // request can never escape via a stale tab value.
  const { user } = useAuth();
  const { data: config, isLoading } = useSyncConfig(module_.id, can.readCrmReports(user?.role));
  const save = useSaveSyncConfig();
  const trigger = useTriggerSync();
  const fields = module_.fields ?? [];

  const [form, setForm] = useState({
    url: '', method: 'GET', authType: 'NONE', authHeaderName: '', authValue: '',
    pollIntervalMin: 15, recordPath: '', externalIdField: '',
    fieldMapping: {} as Record<string, string>,
  });

  useEffect(() => {
    if (config) {
      setForm({
        url: config.url, method: config.method, authType: config.authType,
        authHeaderName: config.authHeaderName ?? '', authValue: '', // never echo back a stored secret
        pollIntervalMin: config.pollIntervalMin, recordPath: config.recordPath ?? '', externalIdField: config.externalIdField ?? '',
        fieldMapping: config.fieldMapping ?? {},
      });
    }
  }, [config?.id]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = { ...form, pollIntervalMin: Number(form.pollIntervalMin) };
    if (!payload.authValue) delete payload.authValue; // keep existing secret if left blank
    save.mutate({ moduleId: module_.id, ...payload });
  }

  if (isLoading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        <div className="skeleton h-16 w-full rounded-card" />
        <div className="skeleton h-10 w-full rounded-card" />
        <div className="skeleton h-10 w-full rounded-card" />
        <div className="skeleton h-10 w-2/3 rounded-card" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Alert tone="info" icon={null}>
        Polls an external REST API on a schedule, validates each record against this module's fields, and upserts it —
        deduped on the field you pick as the external ID (if any). Runs automatically once saved; use "Sync now" to test immediately.
      </Alert>

      {config && (
        <Card padding="sm" flat className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            {config.lastStatus === 'SUCCESS' ? <CheckCircle2 size={15} className="text-success" /> : config.lastStatus === 'FAILED' ? <XCircle size={15} className="text-danger" /> : <Clock size={15} className="text-fg-subtle" />}
            <span className="font-medium text-fg">{config.lastStatus ? `Last sync: ${config.lastStatus}` : 'Never synced'}</span>
          </div>
          {config.lastSyncAt && <span className="text-xs text-fg-subtle">{dateTime(config.lastSyncAt)}</span>}
          {config.lastRecordCount != null && <span className="text-xs text-fg-subtle">· {config.lastRecordCount} record(s)</span>}
          {config.lastError && <span className="text-xs text-danger">· {config.lastError}</span>}
          <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={() => trigger.mutate(module_.id)} loading={trigger.isPending} className="ml-auto">Sync Now</Button>
        </Card>
      )}

      <form onSubmit={submit} className="space-y-3">
        <div className="form-section">
          <p className="form-section-title">Connection</p>
          <div className="space-y-4">
            <Field label="API URL" required>
              <Input aria-label="API URL" required type="url" value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} placeholder="https://api.example.com/records" />
            </Field>
            <FormGrid>
              <Field label="Method">
                <SearchableSelect ariaLabel="Method" value={form.method} onChange={val => setForm(p => ({ ...p, method: val }))} options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} />
              </Field>
              <Field label="Poll every (minutes)">
                <Input aria-label="Poll interval" type="number" min={1} max={1440} className="tabular-nums" value={form.pollIntervalMin} onChange={e => setForm(p => ({ ...p, pollIntervalMin: Number(e.target.value) }))} />
              </Field>
            </FormGrid>
          </div>
        </div>

        <div className="form-section">
          <p className="form-section-title">Authentication</p>
          <div className="space-y-4">
            <FormGrid>
              <Field label="Auth Type">
                <SearchableSelect ariaLabel="Auth Type" value={form.authType} onChange={val => setForm(p => ({ ...p, authType: val }))} options={[{ value: 'NONE', label: 'None' }, { value: 'API_KEY', label: 'API Key Header' }, { value: 'BEARER', label: 'Bearer Token' }]} />
              </Field>
              {form.authType === 'API_KEY' && (
                <Field label="Header Name">
                  <Input aria-label="Auth Header Name" value={form.authHeaderName} onChange={e => setForm(p => ({ ...p, authHeaderName: e.target.value }))} placeholder="X-API-Key" />
                </Field>
              )}
            </FormGrid>
            {form.authType !== 'NONE' && (
              <Field label={form.authType === 'BEARER' ? 'Bearer Token' : 'API Key Value'}>
                <Input aria-label="Auth Value" type="password" value={form.authValue} onChange={e => setForm(p => ({ ...p, authValue: e.target.value }))} placeholder={config ? 'Leave blank to keep existing' : ''} />
              </Field>
            )}
          </div>
        </div>

        <div className="form-section">
          <p className="form-section-title">Data Shape</p>
          <FormGrid>
            <Field label="Record Path">
              <Input aria-label="Record Path" value={form.recordPath} onChange={e => setForm(p => ({ ...p, recordPath: e.target.value }))} placeholder="e.g. data.items (blank = response is the array)" />
            </Field>
            <Field label="External ID Field">
              <Input aria-label="External ID Field" value={form.externalIdField} onChange={e => setForm(p => ({ ...p, externalIdField: e.target.value }))} placeholder="e.g. id (blank = never dedupe)" />
            </Field>
          </FormGrid>
        </div>

        <div className="form-section">
          <p className="form-section-title">Field Mapping</p>
          <p className="form-hint mb-2 mt-0">For each module field, the key to read from each external record.</p>
          <div className="space-y-2">
            {fields.map((f: any) => (
              <div key={f.id} className="flex items-center gap-2">
                <span className="text-sm text-fg-muted w-40 flex-shrink-0 truncate" title={f.label}>{f.label}</span>
                <Input
                  aria-label={`Mapping for ${f.label}`}
                  className="flex-1"
                  value={form.fieldMapping[f.fieldKey] ?? ''}
                  onChange={e => setForm(p => ({ ...p, fieldMapping: { ...p.fieldMapping, [f.fieldKey]: e.target.value } }))}
                  placeholder={`external.${f.fieldKey}`}
                />
              </div>
            ))}
          </div>
        </div>

        <FormActions><Button type="submit" loading={save.isPending}>Save Sync Config</Button></FormActions>
      </form>
    </div>
  );
}

export default function CustomModulesPage() {
  /* /custom-modules and /custom-modules/:id are ALL_STAFF — an EMPLOYEE who
     reaches this URL cannot read a single thing on the page, so refuse once
     instead of firing two doomed reads. Sync config and templates are narrower
     still (CRM_MANAGERS) and are gated separately below. */
  const { user } = useAuth();
  const canReadModules = can.readStaffRecords(user?.role);
  const canManageSync = can.readCrmReports(user?.role);
  const { data: modules, isLoading } = useCustomModules(canReadModules);
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: module_ } = useCustomModule(selectedId ?? undefined, canReadModules);
  const deleteModule = useDeleteCustomModule();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<'fields' | 'records' | 'pipeline' | 'sync'>('records');

  // Deep-link support — the "Manage module" link on a module's own
  // nav-linked page (CustomModuleViewPage) sends managers here pre-selected
  // via ?module=<id>, instead of always landing on whichever module happens
  // to be first alphabetically/by creation order.
  // `?module=` is an ENTRY point, not a binding. The previous version re-ran
  // on every `selectedId` change and unconditionally reset the selection back
  // to the query param, so clicking any other module in the sidebar snapped
  // straight back and the list was effectively frozen. Honour the param once,
  // then leave the user's choice alone.
  const appliedDeepLink = useRef(false);
  useEffect(() => {
    if (!modules?.length) return;
    if (!appliedDeepLink.current) {
      const fromQuery = searchParams.get('module');
      if (fromQuery && modules.some((m: any) => m.id === fromQuery)) {
        appliedDeepLink.current = true;
        setSelectedId(fromQuery);
        return;
      }
      appliedDeepLink.current = true;
    }
    if (!selectedId) setSelectedId(modules[0].id);
  }, [modules, selectedId, searchParams]);

  if (!canReadModules) return <AccessDenied />;

  return (
    <div className="h-full flex flex-col animate-slide-up">
      <PageHeader
        title="Custom Modules"
        subtitle="Build your own objects — fields, records, and real-time API sync"
        actions={<Button icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>New Module</Button>}
      />

      <PageBody width="full" className="flex-1 min-h-0 flex flex-col">
      {isLoading ? (
        <div className="flex flex-col sm:flex-row gap-4" aria-hidden="true">
          <div className="skeleton w-full sm:w-60 h-48 sm:h-72 rounded-card shrink-0" />
          <div className="skeleton flex-1 h-72 rounded-card" />
        </div>
      ) : !modules?.length ? (
        <EmptyState icon={<Layers size={24} />} title="No custom modules yet" description="Create your first module to model data that doesn't fit CRM/IT Desk out of the box" action={{ label: 'New Module', onClick: () => setCreateOpen(true) }} />
      ) : (
        <div className="flex flex-col sm:flex-row gap-4 flex-1 min-h-0">
          <Card padding="none" className="w-full sm:w-60 sm:flex-shrink-0 max-h-48 sm:max-h-none overflow-y-auto p-2 space-y-1">
            {modules.map((m: any) => (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={`w-full text-left px-3 py-2 rounded-btn text-sm flex items-center justify-between gap-2 group transition-colors ${
                  selectedId === m.id ? 'bg-accent-soft text-accent-soft-fg font-medium' : 'text-fg-muted hover:bg-surface-hover'
                }`}
              >
                <span className="truncate" title={m.name}>{m.name}</span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  {m.syncConfig?.isActive && <span title="Sync enabled"><Zap size={11} className="text-info" /></span>}
                  <span className="text-xs text-fg-subtle tabular-nums">{m._count?.records ?? 0}</span>
                </span>
              </button>
            ))}
          </Card>

          <Card padding="none" className="flex-1 min-w-0 p-4 overflow-y-auto">
            {!module_ ? (
              <div className="space-y-3" aria-hidden="true">
                <div className="skeleton h-6 w-1/3" />
                <div className="skeleton h-8 w-2/3" />
                <div className="skeleton h-48 w-full rounded-card" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold text-fg tracking-tight truncate">{module_.name}</h2>
                    {module_.description && <p className="text-xs text-fg-subtle truncate" title={module_.description}>{module_.description}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      label="Edit module"
                      icon={<Pencil size={15} />}
                      onClick={() => setEditOpen(true)}
                    />
                    <IconButton
                      label="Delete module"
                      tone="danger"
                      icon={<Trash2 size={15} />}
                      onClick={() => { if (confirm(`Delete "${module_.name}" and all its records? This can't be undone.`)) { deleteModule.mutate(module_.id); setSelectedId(null); } }}
                    />
                  </div>
                </div>
                <Tabs
                  variant="pill"
                  aria-label="Module section"
                  className="mb-4"
                  items={(['records', 'fields', 'pipeline', 'sync'] as const)
                    // External sync is CRM_MANAGERS-only — no tab for the roles
                    // whose only possible answer from it is a refusal.
                    .filter(t => t !== 'sync' || canManageSync)
                    .map(t => ({ key: t, label: <span className="capitalize">{t}</span> }))}
                  value={tab}
                  onChange={setTab}
                />
                {tab === 'fields' && <FieldsTab module_={module_} />}
                {tab === 'records' && <CustomModuleRecordsTab module_={module_} />}
                {tab === 'pipeline' && <PipelineTab key={module_.id} module_={module_} />}
                {tab === 'sync' && canManageSync && <SyncTab module_={module_} />}
              </>
            )}
          </Card>
        </div>
      )}
      </PageBody>

      <CreateModuleModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={id => { setSelectedId(id); setCreateOpen(false); setTab('fields'); }} />
      {editOpen && module_ && <EditModuleModal module_={module_} onClose={() => setEditOpen(false)} />}
    </div>
  );
}
