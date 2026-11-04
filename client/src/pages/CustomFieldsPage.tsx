import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Settings2, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  SearchableSelect, RowActions,
  PageHeader, PageBody, Card, Tabs, Button, Modal, Field, Input, Checkbox, FormGrid,
  DataTable, EmptyState, Badge, Alert, type Column,
} from '../shared/components';

interface CustomField {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  entityType: string;
  required: boolean;
  options: string[] | null;
  defaultValue?: string | null;
  dependsOnFieldId?: string | null;
  dependsOnValues?: string[] | null;
}

/** Types whose values are knowable up front, so they can drive a rule. */
const PARENT_TYPES = ['SELECT', 'BOOLEAN'];
const BOOLEAN_OPTIONS = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];

const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'TEXTAREA', 'REFERENCE'];
const ENTITY_TYPES = ['TICKET', 'CONTACT', 'DEAL', 'LEAD'];

const TYPE_LABELS: Record<string, string> = {
  TEXT: 'Text', NUMBER: 'Number', DATE: 'Date', BOOLEAN: 'Yes/No', SELECT: 'Dropdown', TEXTAREA: 'Long Text',
  // Always resolves to a Contact today — see CustomFieldsFormFields.tsx's
  // picker and CustomFieldsDisplay.tsx's name lookup for the REFERENCE case.
  REFERENCE: 'Reference (Contact)',
};

const EMPTY_FORM = {
  fieldKey: '', label: '', fieldType: 'TEXT', entityType: 'TICKET', required: false, options: '',
  defaultValue: '', dependsOnFieldId: '', dependsOnValues: [] as string[],
};

/** Server rule (customfields.controller.ts): /^[a-z0-9_]+$/, max 50 chars.
    Coerce anything typed or derived from a label into that shape. */
function sanitizeFieldKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, '_')     // spaces and hyphens become underscores
    .replace(/[^a-z0-9_]/g, '')  // drop anything else invalid
    .replace(/_+/g, '_')         // collapse runs of underscores
    .slice(0, 50);
}

export default function CustomFieldsPage() {
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState('TICKET');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // While false, the API name mirrors the label; a manual edit takes over.
  const [keyTouched, setKeyTouched] = useState(false);

  /* ALL entities' fields in one query. The table filters to the active tab
     below; the visibility-rule pickers filter to the FORM's chosen entity —
     which can differ from the tab (the Entity dropdown in the create modal).
     When they differed, the old per-tab query fed the "Show this field only
     when" list parents from the wrong entity: an admin creating a Contact
     field from the Tickets tab was offered ticket parents (which the server
     then rightly rejected as cross-entity) and never saw the contact fields
     that would actually work — reading as "unable to set the condition". */
  const { data: allFields = [], isLoading } = useQuery<CustomField[]>({
    queryKey: ['custom-fields', 'all'],
    queryFn: () => api.get('/custom-fields').then(r => Array.isArray(r.data) ? r.data : (r.data.data ?? [])),
  });
  const fields = allFields.filter(f => f.entityType === entityType);

  const save = useMutation({
    mutationFn: (body: object) =>
      editing
        ? api.patch(`/custom-fields/${editing.id}`, body).then(r => r.data)
        : api.post('/custom-fields', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
      closeModal();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, entityType });
    setKeyTouched(false);
    setShowModal(true);
  }

  function openEdit(f: CustomField) {
    setEditing(f);
    setForm({
      fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, entityType: f.entityType,
      required: f.required, options: (f.options ?? []).join(', '),
      defaultValue: f.defaultValue ?? '',
      dependsOnFieldId: f.dependsOnFieldId ?? '',
      dependsOnValues: f.dependsOnValues ?? [],
    });
    setKeyTouched(true); // never rewrite an existing field's key from its label
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSubmit() {
    const body = {
      ...form,
      options: form.fieldType === 'SELECT' ? form.options.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      // '' means "no default" — send null so the column is cleared rather than
      // storing an empty string that would prefill a blank into every form.
      defaultValue: form.defaultValue === '' ? null : form.defaultValue,
      // A rule is a pair. With no parent chosen, both halves are cleared.
      dependsOnFieldId: form.dependsOnFieldId || null,
      dependsOnValues: form.dependsOnFieldId ? form.dependsOnValues : null,
    };
    save.mutate(body);
  }

  /* Candidate parents: dropdown/yes-no fields on the same entity, excluding
     the field being edited (a field cannot depend on itself) and any field
     that already depends on this one, which would close a loop. Mirrors the
     checks in customfields.controller.ts so an admin never gets to submit a
     rule the server will reject. */
  const parentOptions = allFields
    .filter(f => f.entityType === form.entityType)
    .filter(f => PARENT_TYPES.includes(f.fieldType))
    .filter(f => f.id !== editing?.id)
    .filter(f => !editing || f.dependsOnFieldId !== editing.id)
    .map(f => ({ value: f.id, label: `${f.label} (${TYPE_LABELS[f.fieldType]})` }));

  const parentField = allFields.find(f => f.id === form.dependsOnFieldId);
  const parentValueOptions = !parentField
    ? []
    : parentField.fieldType === 'BOOLEAN'
      ? BOOLEAN_OPTIONS
      : (parentField.options ?? []).map(o => ({ value: o, label: o }));

  function toggleTriggerValue(value: string) {
    setForm(f => ({
      ...f,
      dependsOnValues: f.dependsOnValues.includes(value)
        ? f.dependsOnValues.filter(v => v !== value)
        : [...f.dependsOnValues, value],
    }));
  }

  const columns: Column<CustomField>[] = [
    { key: 'label', header: 'Label', cell: f => <span className="font-medium text-fg">{f.label}</span> },
    {
      key: 'fieldKey', header: 'API Name',
      cell: f => <code className="text-xs font-mono bg-surface-sunken text-fg px-1.5 py-0.5 rounded-badge" title={f.fieldKey}>{f.fieldKey}</code>,
    },
    {
      key: 'type', header: 'Type', hideBelow: 'sm',
      cell: f => <Badge variant="blue">{TYPE_LABELS[f.fieldType] ?? f.fieldType}</Badge>,
    },
    {
      key: 'required', header: 'Required', hideBelow: 'sm',
      cell: f => f.required
        ? <span className="text-success font-medium">Yes</span>
        : <span className="text-fg-subtle">No</span>,
    },
    { key: 'options', header: 'Options', muted: true, hideBelow: 'lg', cell: f => f.options?.join(', ') ?? '—' },
    {
      key: 'default', header: 'Default', muted: true, hideBelow: 'lg',
      cell: f => f.defaultValue ? <code className="text-xs font-mono">{f.defaultValue}</code> : '—',
    },
    {
      key: 'depends', header: 'Shown when', muted: true, hideBelow: 'md',
      cell: f => {
        if (!f.dependsOnFieldId) return <span className="text-fg-subtle">Always</span>;
        const parent = fields.find(p => p.id === f.dependsOnFieldId);
        if (!parent) return <span className="text-fg-subtle">Always</span>;
        const vals = (f.dependsOnValues ?? [])
          .map(v => parent.fieldType === 'BOOLEAN' ? (v === 'true' ? 'Yes' : 'No') : v)
          .join(' or ');
        return (
          <span className="text-fg-muted" title={`${parent.label} is ${vals}`}>
            {parent.label} is <span className="font-medium text-fg">{vals}</span>
          </span>
        );
      },
    },
    {
      key: 'actions', header: '', width: 56,
      cell: f => (
        <RowActions items={[
          { label: 'Edit field', icon: <Pencil size={14} />, onClick: () => openEdit(f) },
          { label: 'Delete field', icon: <Trash2 size={14} />, onClick: () => { if (confirm('Delete this field?')) remove.mutate(f.id); }, variant: 'danger' },
        ]} />
      ),
    },
  ];

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Custom Fields"
        subtitle="Add extra fields to tickets, contacts, deals, and leads"
        actions={<Button icon={<Plus size={16} />} onClick={openCreate}>Add Field</Button>}
        below={(
          <Tabs
            variant="pill"
            aria-label="Entity type"
            items={ENTITY_TYPES.map(t => ({ key: t, label: t[0] + t.slice(1).toLowerCase() + 's' }))}
            value={entityType}
            onChange={setEntityType}
          />
        )}
      />

      <PageBody width="wide">
        <Card padding="none">
          <DataTable
            columns={columns}
            rows={fields}
            rowKey={f => f.id}
            minWidth={640}
            loading={isLoading}
            empty={(
              <EmptyState
                icon={<Settings2 size={22} />}
                title={`No custom fields for ${entityType.toLowerCase()}s yet`}
                description={`Add a field to capture extra information on every ${entityType.toLowerCase()}.`}
                action={{ label: 'Add Field', onClick: openCreate }}
              />
            )}
          />
        </Card>
      </PageBody>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit Field' : 'Create Custom Field'}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button
              disabled={!form.fieldKey || !form.label || (!!form.dependsOnFieldId && form.dependsOnValues.length === 0)}
              loading={save.isPending}
              onClick={handleSubmit}
            >
              {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Field'}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          {save.isError && (
            <Alert tone="danger">
              {(save.error as any)?.response?.data?.error || 'Could not save this field.'}
            </Alert>
          )}
          <div className="form-section">
            <p className="form-section-title">Field Identity</p>
            <div className="space-y-4">
              <Field label="Label" required>
                <Input aria-label="Label" placeholder="e.g. Customer Type" value={form.label}
                  onChange={e => {
                    const label = e.target.value;
                    setForm(f => ({
                      ...f,
                      label,
                      // Keep the API name in sync with the label until the
                      // user takes over by typing in the API name box.
                      ...(keyTouched ? {} : { fieldKey: sanitizeFieldKey(label) }),
                    }));
                  }} />
              </Field>
              <Field label="API Name" required hint="Lowercase letters, numbers, and underscores only — invalid characters are converted as you type">
                <Input aria-label="API Name" placeholder="e.g. customer_type" value={form.fieldKey}
                  onChange={e => {
                    setKeyTouched(true);
                    const fieldKey = sanitizeFieldKey(e.target.value);
                    setForm(f => ({ ...f, fieldKey }));
                  }} />
              </Field>
            </div>
          </div>
          <div className="form-section">
            <p className="form-section-title">Configuration</p>
            <div className="space-y-4">
              <FormGrid>
                <Field label="Type">
                  <SearchableSelect ariaLabel="Type" value={form.fieldType} onChange={val => setForm(f => ({ ...f, fieldType: val }))} required options={FIELD_TYPES.map(t => ({ value: t, label: TYPE_LABELS[t] }))} />
                </Field>
                <Field label="Entity">
                  {/* Switching entity clears any visibility rule — a parent
                      from the old entity could never be satisfied on the new
                      one, and the server would reject it anyway. */}
                  <SearchableSelect ariaLabel="Entity" value={form.entityType} onChange={val => setForm(f => ({ ...f, entityType: val, dependsOnFieldId: '', dependsOnValues: [] }))} required options={ENTITY_TYPES.map(t => ({ value: t, label: t[0] + t.slice(1).toLowerCase() + 's' }))} />
                </Field>
              </FormGrid>
              {form.fieldType === 'SELECT' && (
                <Field label="Options" hint="Separate options with commas">
                  <Input placeholder="Option A, Option B, Option C" value={form.options}
                    onChange={e => setForm(f => ({ ...f, options: e.target.value }))} />
                </Field>
              )}
              <Checkbox
                label="Mark as required field"
                checked={form.required}
                onChange={e => setForm(f => ({ ...f, required: e.target.checked }))}
              />
            </div>
          </div>

          {/* ── Default value ── */}
          <div className="form-section">
            <p className="form-section-title">Default Value</p>
            <div className="space-y-4">
              <Field
                label="Prefill new records with"
                hint="Applied only when someone creates a record, and can be changed before saving. Existing records are never altered."
              >
                {form.fieldType === 'SELECT' ? (
                  <SearchableSelect
                    ariaLabel="Default value"
                    value={form.defaultValue}
                    onChange={val => setForm(f => ({ ...f, defaultValue: val }))}
                    placeholder="— no default —"
                    options={[
                      { value: '', label: '— no default —' },
                      ...form.options.split(',').map(o => o.trim()).filter(Boolean).map(o => ({ value: o, label: o })),
                    ]}
                  />
                ) : form.fieldType === 'BOOLEAN' ? (
                  <SearchableSelect
                    ariaLabel="Default value"
                    value={form.defaultValue}
                    onChange={val => setForm(f => ({ ...f, defaultValue: val }))}
                    placeholder="— no default —"
                    options={[{ value: '', label: '— no default —' }, ...BOOLEAN_OPTIONS]}
                  />
                ) : (
                  <Input
                    aria-label="Default value"
                    type={form.fieldType === 'NUMBER' ? 'number' : form.fieldType === 'DATE' ? 'date' : 'text'}
                    placeholder={form.fieldType === 'REFERENCE' ? 'Contact id (optional)' : 'Leave blank for no default'}
                    value={form.defaultValue}
                    onChange={e => setForm(f => ({ ...f, defaultValue: e.target.value }))}
                  />
                )}
              </Field>
            </div>
          </div>

          {/* ── Conditional visibility ── */}
          <div className="form-section">
            <p className="form-section-title">Visibility</p>
            <div className="space-y-4">
              <Field
                label="Show this field only when"
                hint={
                  parentOptions.length
                    ? 'Leave blank to always show it. While hidden, the field is never required and its value is not saved.'
                    : `Add a dropdown or Yes/No field to ${form.entityType.toLowerCase()}s first — those are the field types that can control another field.`
                }
              >
                <SearchableSelect
                  ariaLabel="Depends on field"
                  value={form.dependsOnFieldId}
                  onChange={val => setForm(f => ({ ...f, dependsOnFieldId: val, dependsOnValues: [] }))}
                  placeholder="— always show —"
                  options={parentOptions}
                />
              </Field>

              {parentField && (
                <div>
                  <label className="form-label">
                    …has any of these values <span className="req">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {parentValueOptions.map(opt => {
                      const on = form.dependsOnValues.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => toggleTriggerValue(opt.value)}
                          aria-pressed={on}
                          className={`px-2.5 h-8 rounded-btn border text-[12.5px] font-medium transition-colors ${
                            on
                              ? 'bg-accent text-accent-fg border-accent'
                              : 'bg-surface text-fg-muted border-line hover:border-line-strong hover:text-fg'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {parentValueOptions.length === 0 && (
                    <p className="form-hint">
                      "{parentField.label}" has no options defined yet, so there is nothing to trigger on.
                    </p>
                  )}
                  {form.dependsOnValues.length === 0 && parentValueOptions.length > 0 && (
                    <p className="form-hint error">Pick at least one value, or the field would never appear.</p>
                  )}
                  {form.dependsOnValues.length > 0 && (
                    <p className="form-hint">
                      Shows when <strong>{parentField.label}</strong> is{' '}
                      {form.dependsOnValues
                        .map(v => parentField.fieldType === 'BOOLEAN' ? (v === 'true' ? 'Yes' : 'No') : v)
                        .join(' or ')}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
