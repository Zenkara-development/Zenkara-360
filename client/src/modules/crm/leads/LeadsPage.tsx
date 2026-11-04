import { useState, useEffect } from 'react';
import { Target, Plus, ArrowRight, Trash2, CheckCircle2, Sparkles, Mail, Copy, Check, Zap, Calendar, Pencil, ListTodo, Circle, Phone, Users as UsersIcon, ClipboardList } from 'lucide-react';
import { useLeads, useCreateLead, useUpdateLead, useConvertLead, useDeleteLead, useLead, useCreateActivity, useUpdateActivity, useDeleteActivity, usePipeline } from '../../../api/crm';
import { useScoreLead, useLeadFollowUp, useNurtureSequence } from '../../../api/ai';
import {
  PageHeader, PageBody, Toolbar, Button, Modal, Badge, StatusBadge, humanise, leadStatusVariant,
  SearchInput, EmptyState, Spinner, SearchableSelect, RowActions,
  CustomFieldsFormFields, RecordTemplatePicker, Card, DataTable, Alert, IconButton, Field, Input,
  Textarea, Select, Label, Avatar, FormGrid, FormActions, AiInfo, AiNote, AiGeneratedTag, RecordTasks, RecordTags,
  AccessDenied} from '../../../shared/components';
import type { Column } from '../../../shared/components';
import { useCustomFieldDefs, useCustomFieldValues, useSaveCustomFieldValues, toValuesPayload, fromValueRecords } from '../../../api/customFields';
import { useUsers } from '../../../api/users';
import { useDepartments } from '../../../api/people';
import { useLabels } from '../../../hooks/useLabels';
import { Attachments } from '../../../shared/components/Attachments';
import { useAiPrefill } from '../../../hooks/useAiPrefill';
import { useFormat } from '../../../hooks/useFormat';
import { useAuth } from '../../../contexts/AuthContext';
import { can } from '../../../shared/permissions';

const STATUSES = ['NEW','CONTACTED','QUALIFIED','UNQUALIFIED','CONVERTED'];
const SOURCES = ['Web','Referral','Cold Outreach','Event','Social Media','Other'];

function scoreVariant(score: number) {
  if (score >= 75) return 'green' as const;
  if (score >= 50) return 'yellow' as const;
  return 'red' as const;
}

/** Roles a lead can be assigned to — the CRM side of the house. */
const LEAD_ASSIGNEE_ROLES = new Set(['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP']);

function LeadForm({ initial, entityId, onSubmit, loading, aiPrefill }: any) {
  const [form, setForm] = useState(initial || { name: '', email: '', source: '', notes: '', status: 'NEW', assignedTo: '', departmentId: '', ...aiPrefill });
  const { data: departmentsRes } = useDepartments();
  const departmentOptions = (departmentsRes?.data ?? [])
    .filter((d: any) => d.isActive !== false)
    .map((d: any) => ({ value: d.id, label: d.name }));
  // Sales reps + managers for the "Assigned to" picker. Server-side, an
  // unassigned create falls back to whoever files the lead.
  const { data: orgUsers } = useUsers();
  const assigneeOptions = (orgUsers ?? [])
    .filter((u: any) => LEAD_ASSIGNEE_ROLES.has(u.role))
    .map((u: any) => ({ value: u.id, label: u.name }));
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const { data: existingValues } = useCustomFieldValues(entityId);
  useEffect(() => {
    if (existingValues) setCustomValues(fromValueRecords(existingValues));
  }, [existingValues]);
  const f = (k: string) => (e: any) => setForm((p: any) => ({ ...p, [k]: e.target.value }));
  const { entityLabel, fieldLabel } = useLabels();
  const singular = entityLabel('lead', 'singular', 'Lead');
  // Falls back to the exact original text when unset, so the e2e suite's
  // getByLabel(/full name/i) keeps matching for the seeded test org.
  const nameLabel = fieldLabel('lead', 'name', 'Full Name');
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...form, __customFieldValues: customValues }); }} className="space-y-3">
      {!initial && (
        <RecordTemplatePicker
          entityType="LEAD"
          onApply={t => {
            setForm((p: any) => ({ ...p, ...t.fieldValues }));
            if (t.customFieldValues) setCustomValues(p => ({ ...p, ...t.customFieldValues as Record<string, string> }));
          }}
        />
      )}
      <div className="form-section">
        <p className="form-section-title">{singular} Information</p>
        <div className="space-y-4">
          <Field label={nameLabel} required>
            <Input aria-label={nameLabel} required value={form.name} onChange={f('name')} placeholder="e.g. John Doe" />
          </Field>
          <Field label="Email">
            <Input aria-label="Email" type="email" value={form.email} onChange={f('email')} placeholder="john@company.com" />
          </Field>
        </div>
      </div>
      <div className="form-section">
        <p className="form-section-title">Classification</p>
        <FormGrid cols={2}>
          <div>
            <Label>{fieldLabel('lead', 'source', 'Source')}</Label>
            <SearchableSelect ariaLabel={fieldLabel('lead', 'source', 'Source')} value={form.source} onChange={val => setForm((p: any) => ({ ...p, source: val }))} options={SOURCES.map(s => ({ value: s, label: s }))} />
          </div>
          <div>
            <Label>{fieldLabel('lead', 'status', 'Status')}</Label>
            <SearchableSelect ariaLabel={fieldLabel('lead', 'status', 'Status')} value={form.status} onChange={val => setForm((p: any) => ({ ...p, status: val }))} required options={STATUSES.filter(s => s !== 'CONVERTED').map(s => ({ value: s, label: s }))} />
          </div>
          <div>
            <Label>Assigned to</Label>
            <SearchableSelect
              ariaLabel="Assigned to"
              value={form.assignedTo ?? ''}
              onChange={val => setForm((p: any) => ({ ...p, assignedTo: val }))}
              options={assigneeOptions}
              placeholder="Assign a sales rep…"
            />
          </div>
          {departmentOptions.length > 0 && (
            <div>
              <Label>Department</Label>
              <SearchableSelect ariaLabel="Department" value={form.departmentId ?? ''} onChange={val => setForm((p: any) => ({ ...p, departmentId: val }))} options={departmentOptions} placeholder="— none —" />
            </div>
          )}
        </FormGrid>
      </div>
      <div className="form-section">
        <p className="form-section-title">Notes</p>
        <Textarea aria-label="Notes" rows={3} value={form.notes} onChange={f('notes')} placeholder="Any relevant background or context…" />
      </div>
      <CustomFieldsFormFields
        entityType="LEAD"
        values={customValues}
        onChange={(key, value) => setCustomValues(p => ({ ...p, [key]: value }))}
        isNew={!entityId}
      />
      {entityId && <>
              <RecordTags entityType="LEAD" entityId={entityId} />
              <Attachments entityType="LEAD" entityId={entityId} />
              <RecordTasks entityType="LEAD" entityId={entityId} />
            </>}
      <FormActions><Button type="submit" loading={loading}>{initial ? 'Save Changes' : `Create ${singular}`}</Button></FormActions>
    </form>
  );
}

function ConvertLeadModal({ lead, onClose }: { lead: any; onClose: () => void }) {
  const convert = useConvertLead();
  const { data: pipelineData } = usePipeline();
  const stageOptions: string[] = (pipelineData?.pipeline?.stages ?? []).map((s: any) => typeof s === 'string' ? s : s.label);
  const contactName = lead.contact?.name || 'New Deal';
  const [form, setForm] = useState({
    dealTitle: `Deal - ${contactName}`,
    dealValue: '',
    dealStage: '',
    dealProbability: '20',
  });
  useEffect(() => {
    if (!form.dealStage && stageOptions.length) setForm(p => ({ ...p, dealStage: stageOptions[0] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageOptions.length]);
  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    await convert.mutateAsync({ id: lead.id, ...form });
    onClose();
  }

  return (
    <form onSubmit={handleConvert} className="space-y-5">
      <Alert
        tone="accent"
        icon={<Avatar name={contactName} size="md" tone="accent" />}
        actions={<ArrowRight size={18} className="text-accent" />}
        className="items-center"
      >
        <p className="font-semibold text-fg">{contactName}</p>
        <p className="text-xs text-fg-muted">{lead.contact?.email} · {lead.source || 'Unknown source'}</p>
      </Alert>
      <div className="form-section">
        <p className="form-section-title">New Deal Details</p>
        <div className="space-y-4">
          <Field label="Deal Title" required>
            <Input aria-label="Deal Title" required value={form.dealTitle} onChange={f('dealTitle')} />
          </Field>
          <FormGrid cols={2}>
            <Field label="Value ($)">
              <Input aria-label="Value ($)" type="number" min="0" value={form.dealValue} onChange={f('dealValue')} placeholder="0" />
            </Field>
            <Field label="Probability (%)">
              <Input aria-label="Probability (%)" type="number" min="0" max="100" value={form.dealProbability} onChange={f('dealProbability')} />
            </Field>
          </FormGrid>
          <div>
            <Label>Stage</Label>
            <SearchableSelect ariaLabel="Stage" value={form.dealStage} onChange={val => setForm(p => ({ ...p, dealStage: val }))} required options={stageOptions.map(s => ({ value: s, label: s }))} />
          </div>
        </div>
      </div>
      <Alert tone="success" icon={<CheckCircle2 size={16} />}>
        Converting will mark this lead as <strong>Converted</strong> and create the deal in your pipeline.
      </Alert>
      <FormActions>
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={convert.isPending}>Convert Lead</Button>
      </FormActions>
    </form>
  );
}

function FollowUpModal({ lead, onClose }: { lead: any; onClose: () => void }) {
  const followUp = useLeadFollowUp();
  const [result, setResult] = useState<{ subject: string; body: string } | null>(null);
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null);

  async function generate() {
    const data = await followUp.mutateAsync(lead.id);
    setResult(data);
  }

  function copy(text: string, field: 'subject' | 'body') {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-4">
      <Alert tone="accent" icon={<Sparkles size={18} />} className="items-center">
        <p className="font-semibold text-fg">{lead.contact?.name || 'Lead'}</p>
        <p className="text-xs text-fg-muted">{lead.contact?.email} · {lead.source || 'Unknown source'}</p>
      </Alert>

      <AiNote id="lead.followUp" />

      {!result ? (
        <div className="text-center py-6">
          <Button icon={<Sparkles size={15} />} onClick={generate} loading={followUp.isPending}>
            Generate Follow-up Email
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <AiGeneratedTag />
          <Card padding="none" flat className="overflow-hidden">
            <div className="bg-surface-sunken px-4 py-2 flex items-center justify-between border-b border-line-subtle">
              <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">Subject</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => copy(result.subject, 'subject')}
                icon={copied === 'subject' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              >
                {copied === 'subject' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="px-4 py-3 text-sm font-medium text-fg">{result.subject}</p>
          </Card>

          <Card padding="none" flat className="overflow-hidden">
            <div className="bg-surface-sunken px-4 py-2 flex items-center justify-between border-b border-line-subtle">
              <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">Email Body</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => copy(result.body, 'body')}
                icon={copied === 'body' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              >
                {copied === 'body' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <pre className="px-4 py-3 text-sm text-fg-muted whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">{result.body}</pre>
          </Card>

          <div className="flex justify-between pt-1">
            <Button variant="secondary" icon={<Sparkles size={14} />} onClick={generate} loading={followUp.isPending}>Regenerate</Button>
            <Button icon={<Mail size={14} />} onClick={() => { copy(result.body, 'body'); onClose(); }}>Copy &amp; Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NurtureSequenceModal({ lead, onClose }: { lead: any; onClose: () => void }) {
  const nurture = useNurtureSequence();

  return (
    <div className="space-y-4">
      <Alert tone="info" icon={<Calendar size={18} />} className="items-center">
        <p className="font-semibold text-fg">{lead.contact?.name || 'Lead'}</p>
        <p className="text-xs text-fg-muted">{lead.source || 'Unknown source'}</p>
      </Alert>

      <AiNote id="lead.nurture" />

      {!nurture.data ? (
        <div className="text-center py-6">
          <Button icon={<Sparkles size={15} />} onClick={() => nurture.mutate(lead.id)} loading={nurture.isPending}>
            Generate Nurture Sequence
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {nurture.data.sequence.map((step: { day: number; subject: string; body: string }, i: number) => (
            <Card key={i} padding="none" flat className="overflow-hidden">
              <div className="bg-surface-sunken px-4 py-2 flex items-center gap-2 border-b border-line-subtle">
                <div className="w-6 h-6 rounded-full bg-info-soft text-info-fg flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</div>
                <span className="text-xs font-semibold text-info">Day {step.day}</span>
                <span className="text-xs text-fg-muted ml-auto truncate max-w-xs">{step.subject}</span>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-fg-muted mb-1">Subject: {step.subject}</p>
                <pre className="text-xs text-fg-muted whitespace-pre-wrap font-sans leading-relaxed max-h-24 overflow-y-auto">{step.body}</pre>
              </div>
            </Card>
          ))}
          <div className="flex justify-between pt-1">
            <Button variant="secondary" icon={<Sparkles size={14} />} onClick={() => nurture.mutate(lead.id)} loading={nurture.isPending}>Regenerate</Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'TASK'] as const;
const ACTIVITY_ICON: Record<string, any> = { CALL: Phone, EMAIL: Mail, MEETING: UsersIcon, TASK: ClipboardList };

function FollowUpsModal({ lead, onClose }: { lead: any; onClose: () => void }) {
  const { date } = useFormat();
  const { data: fresh, isLoading } = useLead(lead.id);
  const activities = fresh?.activities ?? [];
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();
  const [form, setForm] = useState({ type: 'CALL' as typeof ACTIVITY_TYPES[number], title: '', dueAt: '' });

  function addFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    createActivity.mutate(
      { leadId: lead.id, contactId: lead.contactId ?? lead.contact?.id, type: form.type, title: form.title.trim(), dueAt: form.dueAt || undefined },
      { onSuccess: () => setForm({ type: 'CALL', title: '', dueAt: '' }) }
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="info" icon={<ListTodo size={18} />}>
        <p className="font-semibold text-fg">{lead.contact?.name || 'Lead'}</p>
        <p className="text-xs text-fg-muted">Scheduled calls, emails, meetings and tasks for this lead — separate from deal-side activity once it converts.</p>
      </Alert>

      {isLoading ? <Spinner /> : activities.length === 0 ? (
        <p className="text-sm text-fg-subtle text-center py-4">No follow-ups scheduled yet.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {activities.map((a: any) => {
            const Icon = ACTIVITY_ICON[a.type] || ClipboardList;
            return (
              <Card key={a.id} padding="sm" flat tone={a.done ? 'sunken' : 'default'} className="flex items-start gap-2.5">
                <IconButton
                  size="xs"
                  tone={a.done ? 'success' : 'default'}
                  onClick={() => updateActivity.mutate({ id: a.id, done: !a.done })}
                  className={a.done ? 'text-success' : ''}
                  label={a.done ? 'Mark as not done' : 'Mark as done'}
                  icon={a.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                />
                <Icon size={14} className="text-fg-subtle mt-1.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${a.done ? 'text-fg-subtle line-through' : 'text-fg'}`}>{a.title}</p>
                  {a.body && <p className="text-xs text-fg-muted mt-0.5">{a.body}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    {a.dueAt && <span className="text-[11px] text-fg-subtle">Due {date(a.dueAt)}</span>}
                    {a.createdByUser?.name && <span className="text-[11px] text-fg-subtle">· {a.createdByUser.name}</span>}
                  </div>
                </div>
                <IconButton
                  size="xs"
                  tone="danger"
                  label="Delete follow-up"
                  icon={<Trash2 size={13} />}
                  onClick={() => deleteActivity.mutate(a.id)}
                />
              </Card>
            );
          })}
        </div>
      )}

      <form onSubmit={addFollowUp} className="border-t border-line-subtle pt-3 space-y-2">
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider">Schedule a follow-up</p>
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Follow-up type"
            value={form.type}
            onChange={e => setForm(p => ({ ...p, type: e.target.value as any }))}
            className="w-32"
            options={ACTIVITY_TYPES.map(t => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }))}
          />
          <Input aria-label="Follow-up title" className="flex-1 min-w-[160px]" placeholder="e.g. Call to discuss pricing" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
          <Input aria-label="Follow-up due date" type="date" className="w-40" value={form.dueAt} onChange={e => setForm(p => ({ ...p, dueAt: e.target.value }))} />
          <Button type="submit" size="sm" icon={<Plus size={13} />} loading={createActivity.isPending}>Add</Button>
        </div>
      </form>

      <FormActions><Button variant="secondary" onClick={onClose}>Close</Button></FormActions>
    </div>
  );
}

export function LeadsPage() {
  const { user } = useAuth();
  /* /crm/leads is CRM_STAFF-only on the server; IT_MANAGER, IT_AGENT and
     EMPLOYEE can reach this page by URL. Don't ask for a list we know will be
     refused — and don't render the board around it either. */
  const canReadCrm = can.readCrm(user?.role);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<null | 'create' | { type: 'edit'; lead: any } | { type: 'convert'; lead: any } | { type: 'followup'; lead: any } | { type: 'nurture'; lead: any } | { type: 'followups'; lead: any }>(null);
  const { data: leads, isLoading } = useLeads({ ...(search && { search }), ...(statusFilter && { status: statusFilter }) }, canReadCrm);
  const create = useCreateLead();
  const update = useUpdateLead();
  const del = useDeleteLead();
  const score = useScoreLead();
  const saveCustomFields = useSaveCustomFieldValues();
  const { data: leadFieldDefs } = useCustomFieldDefs('LEAD');
  const { entityLabel } = useLabels();
  const singular = entityLabel('lead', 'singular', 'Lead');
  const plural = entityLabel('lead', 'plural', 'Leads');
  const aiPrefill = useAiPrefill<{ name?: string; email?: string; source?: string; notes?: string; status?: string }>();

  useEffect(() => {
    if (aiPrefill) setModal('create');
  }, [aiPrefill]);

  // After every hook.
  if (!canReadCrm) return <AccessDenied />;

  async function handleSubmit(form: any) {
    const { __customFieldValues, ...rest } = form;
    let leadId: string;
    if (modal === 'create') {
      const created = await create.mutateAsync(rest);
      leadId = created.id;
    } else if (modal && typeof modal === 'object' && (modal as any).type === 'edit') {
      leadId = (modal as any).lead.id;
      await update.mutateAsync({ id: leadId, ...rest });
    } else {
      setModal(null);
      return;
    }
    if (__customFieldValues && leadFieldDefs?.length) {
      const values = toValuesPayload(leadFieldDefs, __customFieldValues);
      if (values.length) await saveCustomFields.mutateAsync({ entityId: leadId, values });
    }
    setModal(null);
  }

  const leadColumns: Column<any>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (lead: any) => (
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={lead.contact?.name || '?'} size="sm" />
          <span className="font-medium text-fg truncate" title={lead.contact?.name || undefined}>{lead.contact?.name || '--'}</span>
        </div>
      ),
    },
    {
      key: 'email', header: 'Email', hideBelow: 'sm', muted: true,
      cell: (lead: any) => <span className="block max-w-[220px] truncate" title={lead.contact?.email || undefined}>{lead.contact?.email || '--'}</span>,
    },
    { key: 'source', header: 'Source', hideBelow: 'md', muted: true, cell: (lead: any) => lead.source || '--' },
    {
      key: 'status',
      header: 'Status',
      cell: (lead: any) => <StatusBadge value={lead.status} map={leadStatusVariant} dot />,
    },
    {
      key: 'department', header: 'Department', hideBelow: 'lg', muted: true,
      cell: (lead: any) => lead.department?.name || '--',
    },
    {
      key: 'assignee', header: 'Assigned to', hideBelow: 'md', muted: true,
      cell: (lead: any) => lead.assignee?.name ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar name={lead.assignee.name} size="xs" />
          <span className="truncate" title={lead.assignee.name}>{lead.assignee.name}</span>
        </div>
      ) : <span className="text-fg-subtle">Unassigned</span>,
    },
    {
      key: 'aiScore',
      // One ⓘ on the column header rather than one per row: it explains both
      // the "Score" button and the re-score action, and scoring writes the
      // result straight onto the lead.
      header: <span className="inline-flex items-center gap-1">AI Score <AiInfo id="lead.score" /></span>,
      cell: (lead: any) => lead.aiScore != null ? (
        <div className="flex items-center gap-1.5">
          <Badge variant={scoreVariant(lead.aiScore)} className="tabular-nums">{lead.aiScore}</Badge>
          <IconButton
            size="xs"
            tone="accent"
            label={lead.aiScoreReason || 'Re-score'}
            icon={<Zap size={12} />}
            onClick={() => score.mutate(lead.id)}
          />
        </div>
      ) : (
        <Button variant="ghost" size="xs" icon={<Sparkles size={12} />} onClick={() => score.mutate(lead.id)} disabled={score.isPending}>
          {score.isPending ? 'Scoring...' : 'Score'}
        </Button>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      hideBelow: 'lg',
      muted: true,
      cell: (lead: any) => <span className="text-xs block max-w-xs truncate" title={lead.notes || undefined}>{lead.notes}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (lead: any) => (
        <div className="flex items-center justify-end gap-1">
          <IconButton
            label="Follow-up activities"
            tone="accent"
            className="relative"
            icon={
              <>
                <ListTodo size={14} />
                {lead._count?.activities > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-accent text-accent-fg text-[9px] leading-[14px] text-center tabular-nums">{lead._count.activities}</span>
                )}
              </>
            }
            onClick={() => setModal({ type: 'followups', lead })}
          />
          {lead.status !== 'CONVERTED' ? (
            <Button size="sm" variant="secondary" icon={<ArrowRight size={13} />} onClick={() => setModal({ type: 'convert', lead })}>
              Convert
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-success font-medium px-2">
              <CheckCircle2 size={13} /> Converted
            </span>
          )}
          <RowActions items={[
            { label: 'AI follow-up email', icon: <Mail size={14} />, onClick: () => setModal({ type: 'followup', lead }) },
            { label: 'AI nurture sequence', icon: <Calendar size={14} />, onClick: () => setModal({ type: 'nurture', lead }) },
            { label: 'Edit lead', icon: <Pencil size={14} />, onClick: () => setModal({ type: 'edit', lead }) },
            { label: 'Delete lead', icon: <Trash2 size={14} />, onClick: () => del.mutate(lead.id), variant: 'danger' },
          ]} />
        </div>
      ),
    },
  ];

  const filtersActive = Boolean(search || statusFilter);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={plural}
        subtitle={isLoading ? undefined : `${leads?.length ?? 0} ${plural.toLowerCase()}`}
        actions={<Button icon={<Plus size={15} />} onClick={() => setModal('create')}>New {singular}</Button>}
        below={
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder={`Search ${plural.toLowerCase()}...`} />
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              placeholder="All Statuses"
              options={STATUSES.map(s => ({ value: s, label: humanise(s) }))}
              className="w-40"
            />
          </Toolbar>
        }
      />

      <PageBody>
        <Card padding="none" className="overflow-hidden">
          <DataTable
            columns={leadColumns}
            rows={leads ?? []}
            rowKey={(l: any) => l.id}
            minWidth={600}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<Target size={24} />}
                title={filtersActive ? `No matching ${plural.toLowerCase()}` : `No ${plural.toLowerCase()} yet`}
                description={filtersActive
                  ? 'Nothing matches your search or status filter. Try broadening or clearing them.'
                  : `Capture your first ${singular.toLowerCase()} to start building your pipeline. AI can score and nurture it from here.`}
                action={filtersActive ? undefined : { label: `New ${singular}`, onClick: () => setModal('create') }}
                secondaryAction={filtersActive ? { label: 'Clear filters', onClick: () => { setSearch(''); setStatusFilter(''); } } : undefined}
              />
            }
          />
        </Card>
      </PageBody>

      <Modal open={modal === 'create' || (typeof modal === 'object' && modal !== null && (modal as any).type === 'edit')}
        onClose={() => setModal(null)} title={modal === 'create' ? `New ${singular}` : `Edit ${singular}`}>
        <LeadForm
          initial={modal && typeof modal === 'object' && (modal as any).type === 'edit'
            ? {
                name: (modal as any).lead.contact?.name || '',
                email: (modal as any).lead.contact?.email || '',
                source: (modal as any).lead.source || '',
                notes: (modal as any).lead.notes || '',
                status: (modal as any).lead.status || 'NEW',
                assignedTo: (modal as any).lead.assignedTo || (modal as any).lead.assignee?.id || '',
                departmentId: (modal as any).lead.departmentId || (modal as any).lead.department?.id || '',
              }
            : null}
          entityId={modal && typeof modal === 'object' && (modal as any).type === 'edit' ? (modal as any).lead.id : undefined}
          onSubmit={handleSubmit} loading={create.isPending || update.isPending}
          aiPrefill={modal === 'create' ? aiPrefill : null} />
      </Modal>

      <Modal open={typeof modal === 'object' && modal !== null && (modal as any).type == 'convert'}
        onClose={() => setModal(null)}
        title="Convert Lead to Deal"
      >
        {modal && typeof modal === 'object' && (modal as any).type === 'convert' && (
          <ConvertLeadModal lead={(modal as any).lead} onClose={() => setModal(null)} />
        )}
      </Modal>

      <Modal
        open={typeof modal === 'object' && modal !== null && (modal as any).type === 'followup'}
        onClose={() => setModal(null)}
        title="AI Follow-up Email"
      >
        {modal && typeof modal === 'object' && (modal as any).type === 'followup' && (
          <FollowUpModal lead={(modal as any).lead} onClose={() => setModal(null)} />
        )}
      </Modal>

      <Modal
        open={typeof modal === 'object' && modal !== null && (modal as any).type === 'nurture'}
        onClose={() => setModal(null)}
        title="AI Nurture Sequence"
      >
        {modal && typeof modal === 'object' && (modal as any).type === 'nurture' && (
          <NurtureSequenceModal lead={(modal as any).lead} onClose={() => setModal(null)} />
        )}
      </Modal>

      <Modal
        open={typeof modal === 'object' && modal !== null && (modal as any).type === 'followups'}
        onClose={() => setModal(null)}
        title="Follow-up Activities"
      >
        {modal && typeof modal === 'object' && (modal as any).type === 'followups' && (
          <FollowUpsModal lead={(modal as any).lead} onClose={() => setModal(null)} />
        )}
      </Modal>
    </div>
  );
}
