import { useState } from 'react';
import { LayoutTemplate, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  SearchableSelect, RowActions, CustomFieldsFormFields,
  PageHeader, PageBody, Card, Tabs, Button, IconButton, Modal,
  Field, Input, Textarea, DataTable, EmptyState, Toolbar, FormGrid, AccessDenied,
  type Column,
} from '../shared/components';
import { useAccounts } from '../api/crm';
import { useCategories } from '../api/itdesk';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';
import {
  RecordTemplate, useRecordTemplates, useCreateRecordTemplate, useUpdateRecordTemplate, useDeleteRecordTemplate,
  ReplyTemplate, useReplyTemplates, useCreateReplyTemplate, useUpdateReplyTemplate, useDeleteReplyTemplate,
  EmailTemplate, useEmailTemplates, useCreateEmailTemplate, useUpdateEmailTemplate, useDeleteEmailTemplate,
  QuoteTemplate, useQuoteTemplates, useCreateQuoteTemplate, useUpdateQuoteTemplate, useDeleteQuoteTemplate,
} from '../api/templates';

const TOP_TABS = ['Records', 'Replies', 'Emails', 'Quotes'] as const;
type TopTab = typeof TOP_TABS[number];

const ENTITY_TYPES = ['TICKET', 'CONTACT', 'DEAL', 'LEAD'] as const;
const SOURCES = ['Web', 'Referral', 'Cold Outreach', 'Event', 'Social Media', 'Other'];
const STAGES = ['Prospecting', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'];

const entityLabel = (t: string) => t[0] + t.slice(1).toLowerCase() + 's';

/** Truncated template name cell — long names get a tooltip instead of breaking the row. */
function NameCell({ name }: { name: string }) {
  return <span className="font-medium text-fg block max-w-[240px] truncate" title={name}>{name}</span>;
}

/** Shared edit/delete menu — identical in all four tabs. */
function templateRowActions(onEdit: () => void, onDelete: () => void) {
  return (
    <RowActions items={[
      { label: 'Edit template', icon: <Pencil size={14} />, onClick: onEdit },
      { label: 'Delete template', icon: <Trash2 size={14} />, onClick: onDelete, variant: 'danger' },
    ]} />
  );
}

// ─── Record Templates (Ticket/Contact/Deal/Lead form pre-fill) ────────────────

const RECORD_TEMPLATE_EMPTY_FORM = { name: '', description: '', entityType: 'TICKET' as string, fieldValues: {} as Record<string, any> };

function RecordTemplatesTab() {
  const [entityType, setEntityType] = useState<string>('TICKET');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<RecordTemplate | null>(null);
  const [form, setForm] = useState(RECORD_TEMPLATE_EMPTY_FORM);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const { user } = useAuth();
  /* The account picker's /crm/accounts is CRM_STAFF-only, narrower than the
     ALL_STAFF guard on the templates themselves — an IT_MANAGER or IT_AGENT
     manages templates but cannot read accounts, so that one field goes away
     rather than firing a request that can only be refused. */
  const canReadCrm = can.readCrm(user?.role);

  const { data: templates = [], isLoading } = useRecordTemplates(entityType);
  const { data: accounts } = useAccounts(undefined, canReadCrm);
  const { data: categories } = useCategories();
  const create = useCreateRecordTemplate();
  const update = useUpdateRecordTemplate();
  const remove = useDeleteRecordTemplate();

  function openCreate() {
    setEditing(null);
    setForm({ ...RECORD_TEMPLATE_EMPTY_FORM, entityType });
    setCustomValues({});
    setShowModal(true);
  }
  function openEdit(t: RecordTemplate) {
    setEditing(t);
    setForm({ name: t.name, description: t.description ?? '', entityType: t.entityType, fieldValues: t.fieldValues ?? {} });
    setCustomValues((t.customFieldValues as Record<string, string>) ?? {});
    setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSubmit() {
    const body = {
      name: form.name,
      description: form.description || undefined,
      entityType: form.entityType,
      fieldValues: form.fieldValues,
      customFieldValues: Object.keys(customValues).length ? customValues : undefined,
    };
    const mutation = editing ? update.mutateAsync({ id: editing.id, ...body }) : create.mutateAsync(body);
    // .catch() here just prevents an unhandled promise rejection when the
    // save fails (e.g. duplicate name) — the api client's response
    // interceptor already shows the user a toast with the server's error.
    // Without it the dialog correctly stays open (so the admin can fix the
    // conflicting field), but the rejection was otherwise unhandled.
    mutation.then(closeModal).catch(() => {});
  }

  const fv = (k: string) => (v: any) => setForm(f => ({ ...f, fieldValues: { ...f.fieldValues, [k]: v } }));

  const saving = create.isPending || update.isPending;

  const columns: Column<RecordTemplate>[] = [
    { key: 'name', header: 'Name', cell: t => <NameCell name={t.name} /> },
    { key: 'description', header: 'Description', muted: true, hideBelow: 'sm', cell: t => t.description || '—' },
    {
      key: 'actions', header: '', width: 56,
      cell: t => templateRowActions(
        () => openEdit(t),
        () => { if (confirm('Delete this template?')) remove.mutate(t.id); },
      ),
    },
  ];

  return (
    <div>
      <Toolbar
        className="mb-4"
        right={<Button icon={<Plus size={16} />} onClick={openCreate}>New Template</Button>}
      >
        <Tabs
          variant="pill"
          aria-label="Entity type"
          items={ENTITY_TYPES.map(t => ({ key: t as string, label: entityLabel(t) }))}
          value={entityType}
          onChange={setEntityType}
        />
      </Toolbar>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={templates}
          rowKey={t => t.id}
          minWidth={500}
          loading={isLoading}
          empty={(
            <EmptyState
              icon={<LayoutTemplate size={22} />}
              title={`No templates for ${entityType.toLowerCase()}s yet`}
              description={`Pre-fill common ${entityType.toLowerCase()} values so new records start consistent.`}
              action={{ label: 'New Template', onClick: openCreate }}
            />
          )}
        />
      </Card>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit Template' : 'Create Record Template'}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button disabled={!form.name} loading={saving} onClick={handleSubmit}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Template'}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <div className="form-section">
            <p className="form-section-title">Template Identity</p>
            <div className="space-y-4">
              <Field label="Name" required>
                <Input aria-label="Name" placeholder="e.g. VIP Onboarding Deal" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Description">
                <Input aria-label="Description" placeholder="Optional note for other admins" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </Field>
              {!editing && (
                <Field label="Entity">
                  <SearchableSelect ariaLabel="Entity" value={form.entityType} onChange={val => setForm(f => ({ ...f, entityType: val, fieldValues: {} }))}
                    required options={ENTITY_TYPES.map(t => ({ value: t, label: entityLabel(t) }))} />
                </Field>
              )}
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Default Values</p>
            <div className="space-y-4">
              {form.entityType === 'TICKET' && (
                <>
                  <Field label="Priority">
                    <SearchableSelect ariaLabel="Priority" value={form.fieldValues.priority ?? ''} onChange={fv('priority')}
                      options={PRIORITIES.map(p => ({ value: p, label: p }))} placeholder="— none —" />
                  </Field>
                  <Field label="Category">
                    <SearchableSelect ariaLabel="Category" value={form.fieldValues.categoryId ?? ''} onChange={fv('categoryId')}
                      options={(categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} placeholder="— none —" />
                  </Field>
                  <Field label="Description boilerplate">
                    <Textarea aria-label="Description boilerplate" rows={3} value={form.fieldValues.body ?? ''}
                      onChange={e => fv('body')(e.target.value)} placeholder="Pre-filled description text agents can edit further…" />
                  </Field>
                </>
              )}
              {form.entityType === 'CONTACT' && (
                <>
                  <Field label="Job Title">
                    <Input aria-label="Job Title" value={form.fieldValues.jobTitle ?? ''} onChange={e => fv('jobTitle')(e.target.value)} />
                  </Field>
                  <Field label="Source">
                    <SearchableSelect ariaLabel="Source" value={form.fieldValues.source ?? ''} onChange={fv('source')}
                      options={SOURCES.map(s => ({ value: s, label: s }))} placeholder="— none —" />
                  </Field>
                  {canReadCrm && (
                    <Field label="Account">
                      <SearchableSelect ariaLabel="Account" value={form.fieldValues.accountId ?? ''} onChange={fv('accountId')}
                        options={(accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }))} placeholder="— none —" />
                    </Field>
                  )}
                </>
              )}
              {form.entityType === 'DEAL' && (
                <>
                  <Field label="Stage">
                    <SearchableSelect ariaLabel="Stage" value={form.fieldValues.stage ?? ''} onChange={fv('stage')}
                      options={STAGES.map(s => ({ value: s, label: s }))} placeholder="— none —" />
                  </Field>
                  <Field label="Probability (%)">
                    <Input aria-label="Probability (%)" type="number" min="0" max="100" value={form.fieldValues.probability ?? ''}
                      onChange={e => fv('probability')(e.target.value)} />
                  </Field>
                  {canReadCrm && (
                    <Field label="Account">
                      <SearchableSelect ariaLabel="Account" value={form.fieldValues.accountId ?? ''} onChange={fv('accountId')}
                        options={(accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }))} placeholder="— none —" />
                    </Field>
                  )}
                </>
              )}
              {form.entityType === 'LEAD' && (
                <>
                  <Field label="Source">
                    <SearchableSelect ariaLabel="Source" value={form.fieldValues.source ?? ''} onChange={fv('source')}
                      options={SOURCES.map(s => ({ value: s, label: s }))} placeholder="— none —" />
                  </Field>
                  <Field label="Status">
                    <SearchableSelect ariaLabel="Status" value={form.fieldValues.status ?? ''} onChange={fv('status')}
                      options={LEAD_STATUSES.map(s => ({ value: s, label: s }))} placeholder="— none —" />
                  </Field>
                  <Field label="Notes boilerplate">
                    <Textarea aria-label="Notes boilerplate" rows={3} value={form.fieldValues.notes ?? ''}
                      onChange={e => fv('notes')(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          </div>

          <CustomFieldsFormFields
            entityType={form.entityType}
            values={customValues}
            onChange={(key, value) => setCustomValues(p => ({ ...p, [key]: value }))}
          />
        </div>
      </Modal>
    </div>
  );
}

// ─── Reply Templates (ticket canned responses) ────────────────────────────────

function ReplyTemplatesTab() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ReplyTemplate | null>(null);
  const [form, setForm] = useState({ name: '', body: '' });

  const { data: templates = [], isLoading } = useReplyTemplates();
  const create = useCreateReplyTemplate();
  const update = useUpdateReplyTemplate();
  const remove = useDeleteReplyTemplate();

  function openCreate() { setEditing(null); setForm({ name: '', body: '' }); setShowModal(true); }
  function openEdit(t: ReplyTemplate) { setEditing(t); setForm({ name: t.name, body: t.body }); setShowModal(true); }
  function closeModal() { setShowModal(false); setEditing(null); }
  function handleSubmit() {
    const mutation = editing ? update.mutateAsync({ id: editing.id, ...form }) : create.mutateAsync(form);
    // .catch() here just prevents an unhandled promise rejection when the
    // save fails (e.g. duplicate name) — the api client's response
    // interceptor already shows the user a toast with the server's error.
    // Without it the dialog correctly stays open (so the admin can fix the
    // conflicting field), but the rejection was otherwise unhandled.
    mutation.then(closeModal).catch(() => {});
  }

  const saving = create.isPending || update.isPending;

  const columns: Column<ReplyTemplate>[] = [
    { key: 'name', header: 'Name', cell: t => <NameCell name={t.name} /> },
    { key: 'preview', header: 'Preview', muted: true, hideBelow: 'sm', cell: t => <span className="block truncate max-w-xs" title={t.body}>{t.body}</span> },
    {
      key: 'actions', header: '', width: 56,
      cell: t => templateRowActions(
        () => openEdit(t),
        () => { if (confirm('Delete this template?')) remove.mutate(t.id); },
      ),
    },
  ];

  return (
    <div>
      <Toolbar className="mb-4" right={<Button icon={<Plus size={16} />} onClick={openCreate}>New Reply Template</Button>} />
      <Card padding="none">
        <DataTable
          columns={columns}
          rows={templates}
          rowKey={t => t.id}
          minWidth={500}
          loading={isLoading}
          empty={(
            <EmptyState
              icon={<LayoutTemplate size={22} />}
              title="No canned responses yet"
              description="Save the replies agents type most so answering a ticket takes one click."
              action={{ label: 'New Reply Template', onClick: openCreate }}
            />
          )}
        />
      </Card>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit Reply Template' : 'Create Reply Template'}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button disabled={!form.name || !form.body} loading={saving} onClick={handleSubmit}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Template'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input aria-label="Name" placeholder="e.g. Password Reset Instructions" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Message" required>
            <Textarea aria-label="Message" rows={6} placeholder="Hi there, thanks for reaching out…" value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ─── Email Templates (campaigns) ──────────────────────────────────────────────

function EmailTemplatesTab() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [form, setForm] = useState({ name: '', subject: '', body: '' });

  const { data: templates = [], isLoading } = useEmailTemplates();
  const create = useCreateEmailTemplate();
  const update = useUpdateEmailTemplate();
  const remove = useDeleteEmailTemplate();

  function openCreate() { setEditing(null); setForm({ name: '', subject: '', body: '' }); setShowModal(true); }
  function openEdit(t: EmailTemplate) { setEditing(t); setForm({ name: t.name, subject: t.subject, body: t.body }); setShowModal(true); }
  function closeModal() { setShowModal(false); setEditing(null); }
  function handleSubmit() {
    const mutation = editing ? update.mutateAsync({ id: editing.id, ...form }) : create.mutateAsync(form);
    // .catch() here just prevents an unhandled promise rejection when the
    // save fails (e.g. duplicate name) — the api client's response
    // interceptor already shows the user a toast with the server's error.
    // Without it the dialog correctly stays open (so the admin can fix the
    // conflicting field), but the rejection was otherwise unhandled.
    mutation.then(closeModal).catch(() => {});
  }

  const saving = create.isPending || update.isPending;

  const columns: Column<EmailTemplate>[] = [
    { key: 'name', header: 'Name', cell: t => <NameCell name={t.name} /> },
    { key: 'subject', header: 'Subject', muted: true, hideBelow: 'sm', cell: t => <span className="block truncate max-w-xs" title={t.subject}>{t.subject}</span> },
    {
      key: 'actions', header: '', width: 56,
      cell: t => templateRowActions(
        () => openEdit(t),
        () => { if (confirm('Delete this template?')) remove.mutate(t.id); },
      ),
    },
  ];

  return (
    <div>
      <Toolbar className="mb-4" right={<Button icon={<Plus size={16} />} onClick={openCreate}>New Email Template</Button>} />
      <Card padding="none">
        <DataTable
          columns={columns}
          rows={templates}
          rowKey={t => t.id}
          minWidth={500}
          loading={isLoading}
          empty={(
            <EmptyState
              icon={<LayoutTemplate size={22} />}
              title="No email templates yet"
              description="Write a campaign email once and reuse it — subject, body and all."
              action={{ label: 'New Email Template', onClick: openCreate }}
            />
          )}
        />
      </Card>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit Email Template' : 'Create Email Template'}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button disabled={!form.name || !form.subject || !form.body} loading={saving} onClick={handleSubmit}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Template'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input aria-label="Name" placeholder="e.g. Q1 Lead Nurture" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Subject" required>
            <Input aria-label="Subject" placeholder="e.g. Exclusive offer just for you" value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          </Field>
          <Field label="Body" required>
            <Textarea aria-label="Body" rows={8} placeholder="Write your email content here…" value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ─── Quote Templates ───────────────────────────────────────────────────────────

const QUOTE_EMPTY_LINE = { description: '', quantity: 1, unitPrice: 0 };

function QuoteTemplatesTab() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<QuoteTemplate | null>(null);
  const [form, setForm] = useState({ name: '', description: '', lines: [{ ...QUOTE_EMPTY_LINE }] });

  const { data: templates = [], isLoading } = useQuoteTemplates();
  const create = useCreateQuoteTemplate();
  const update = useUpdateQuoteTemplate();
  const remove = useDeleteQuoteTemplate();

  function openCreate() { setEditing(null); setForm({ name: '', description: '', lines: [{ ...QUOTE_EMPTY_LINE }] }); setShowModal(true); }
  function openEdit(t: QuoteTemplate) {
    setEditing(t);
    setForm({ name: t.name, description: t.description ?? '', lines: t.lines.map(l => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })) });
    setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditing(null); }
  function handleSubmit() {
    const body = { name: form.name, description: form.description || undefined, lines: form.lines };
    const mutation = editing ? update.mutateAsync({ id: editing.id, ...body }) : create.mutateAsync(body);
    // .catch() here just prevents an unhandled promise rejection when the
    // save fails (e.g. duplicate name) — the api client's response
    // interceptor already shows the user a toast with the server's error.
    // Without it the dialog correctly stays open (so the admin can fix the
    // conflicting field), but the rejection was otherwise unhandled.
    mutation.then(closeModal).catch(() => {});
  }
  function updateLine(i: number, field: string, value: string | number) {
    setForm(f => { const lines = [...f.lines]; lines[i] = { ...lines[i], [field]: value }; return { ...f, lines }; });
  }
  function addLine() { setForm(f => ({ ...f, lines: [...f.lines, { ...QUOTE_EMPTY_LINE }] })); }
  function removeLine(i: number) { setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) })); }

  const saving = create.isPending || update.isPending;

  const columns: Column<QuoteTemplate>[] = [
    { key: 'name', header: 'Name', cell: t => <NameCell name={t.name} /> },
    { key: 'lines', header: 'Line Items', muted: true, cell: t => <span className="tabular-nums">{t.lines.length} item{t.lines.length === 1 ? '' : 's'}</span> },
    {
      key: 'actions', header: '', width: 56,
      cell: t => templateRowActions(
        () => openEdit(t),
        () => { if (confirm('Delete this template?')) remove.mutate(t.id); },
      ),
    },
  ];

  return (
    <div>
      <Toolbar className="mb-4" right={<Button icon={<Plus size={16} />} onClick={openCreate}>New Quote Template</Button>} />
      <Card padding="none">
        <DataTable
          columns={columns}
          rows={templates}
          rowKey={t => t.id}
          minWidth={500}
          loading={isLoading}
          empty={(
            <EmptyState
              icon={<LayoutTemplate size={22} />}
              title="No quote templates yet"
              description="Define standard line items once, then generate consistent quotes in seconds."
              action={{ label: 'New Quote Template', onClick: openCreate }}
            />
          )}
        />
      </Card>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit Quote Template' : 'Create Quote Template'}
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button disabled={!form.name || form.lines.length === 0} loading={saving} onClick={handleSubmit}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Template'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label="Name" required>
              <Input aria-label="Name" placeholder="e.g. Standard Support Package" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Description">
              <Input aria-label="Template Description" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Field>
          </FormGrid>
          <div className="form-section">
            <p className="form-section-title">Line Items</p>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-fg-muted uppercase px-1">
                <div className="col-span-6">Description</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-3">Unit Price</div>
                <div className="col-span-1"></div>
              </div>
              {form.lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input inputSize="sm" className="col-span-6"
                    aria-label="Description" placeholder="Service description" value={line.description}
                    onChange={e => updateLine(i, 'description', e.target.value)} />
                  <Input inputSize="sm" type="number" min="1" aria-label="Qty" className="col-span-2 text-center tabular-nums"
                    value={line.quantity} onChange={e => updateLine(i, 'quantity', Number(e.target.value))} />
                  <Input inputSize="sm" type="number" min="0" step="0.01" className="col-span-3 tabular-nums"
                    aria-label="Price" placeholder="0.00" value={line.unitPrice}
                    onChange={e => updateLine(i, 'unitPrice', Number(e.target.value))} />
                  <div className="col-span-1 flex justify-center">
                    <IconButton
                      label="Remove line"
                      tone="danger"
                      icon={<Trash2 size={14} />}
                      onClick={() => removeLine(i)}
                      disabled={form.lines.length === 1}
                      className={form.lines.length === 1 ? 'opacity-0' : ''}
                    />
                  </div>
                </div>
              ))}
              <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={addLine} className="mt-1">
                Add line
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TopTab>('Records');

  /* Every one of /templates/records|replies|emails|quotes is ALL_STAFF-only,
     so for an EMPLOYEE — who can reach this page by URL — there is no tab
     here that could load. Show the access screen rather than four tabs of
     guaranteed refusals. After every hook. */
  if (!can.manageTemplates(user?.role)) return <AccessDenied />;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Templates"
        subtitle="Speed up record creation, ticket replies, campaigns, and quotes"
        below={(
          <Tabs
            variant="pill"
            aria-label="Template type"
            items={TOP_TABS.map(t => ({ key: t, label: t }))}
            value={tab}
            onChange={setTab}
          />
        )}
      />

      <PageBody width="wide">
        {tab === 'Records' && <RecordTemplatesTab />}
        {tab === 'Replies' && <ReplyTemplatesTab />}
        {tab === 'Emails' && <EmailTemplatesTab />}
        {tab === 'Quotes' && <QuoteTemplatesTab />}
      </PageBody>
    </div>
  );
}
