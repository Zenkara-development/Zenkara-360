import { useState, useEffect } from 'react';
import { Ticket, Plus, Clock, CheckCircle, AlertCircle, Pencil, Sparkles, Copy, Check, SmilePlus, Route, Layers, AlertTriangle, BookOpen, ChevronDown, MessageCircleMore, Link2 } from 'lucide-react';
import { useTickets, useTicket, useCreateTicket, useUpdateTicket, useChangeTicketStatus, useAssignTicket, useTicketReports, useArticleSuggestions, useCreateArticle } from '../../../api/itdesk';
import { useCategories } from '../../../api/itdesk';
import { useUsers } from '../../../api/users';
import { useContacts } from '../../../api/crm';
import { useAuth } from '../../../contexts/AuthContext';
import { useTicketReply, useTicketSentiment, useSummarizeThread, useEstimateResolution, useSlaRisk, useKbArticle, useDetectDuplicates } from '../../../api/ai';
import {
  PageHeader, PageBody, Toolbar, Button, IconButton, Modal, Badge, EmptyState, SearchInput, SearchableSelect,
  CustomFieldsFormFields, CustomFieldsDisplay, RecordTemplatePicker, ScheduleReminderPanel,
  Card, CardSection, StatTile, Alert, Tabs, DataTable, Field, Input, Select,
  AiInfo, AiNote, AiGeneratedTag, SkeletonStats, RichText, RichTextEditor,
  type Column, RecordTasks, RecordTags} from '../../../shared/components';
import { useCustomFieldDefs, useSaveCustomFieldValues, toValuesPayload } from '../../../api/customFields';
import { useDepartments } from '../../../api/people';
import { Comments } from '../../../shared/components/Comments';
import { Attachments } from '../../../shared/components/Attachments';
import { TimeTrackingPanel } from './TimeTrackingPanel';
import { ChatThreadView } from '../../../shared/components/ChatThreadView';
import { RelatedRecords } from '../../../shared/components/RelatedRecords';
import { useRecordThread } from '../../../api/chat';
import { api } from '../../../api/client';
import { ticketStatusVariant, priorityVariant, humanise } from '../../../shared/components/Badge';
import { formatDistanceToNow } from 'date-fns';
import { useLabels } from '../../../hooks/useLabels';
import { useAiPrefill } from '../../../hooks/useAiPrefill';
import { can } from '../../../shared/permissions';

type BadgeVariant = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange' | 'indigo' | 'teal' | 'accent';

/* Sentiment now reuses Badge's palette instead of carrying its own set of
   `bg-*-50 dark:bg-*-500/10 border-*` strings. */
const sentimentConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  POSITIVE:   { label: '😊 Positive',   variant: 'green' },
  NEUTRAL:    { label: '😐 Neutral',    variant: 'gray' },
  NEGATIVE:   { label: '😟 Negative',   variant: 'orange' },
  FRUSTRATED: { label: '😤 Frustrated', variant: 'red' },
};

const PRIORITIES = ['LOW','MEDIUM','HIGH','CRITICAL'];
const STATUSES = ['OPEN','IN_PROGRESS','PENDING','RESOLVED','CLOSED'];
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'New', IN_PROGRESS: 'In Progress', PENDING: 'Pending', RESOLVED: 'Resolved', CLOSED: 'Closed',
};

const FILING_TABS = [
  { key: 'self' as const, label: 'Myself' },
  { key: 'user' as const, label: 'A teammate' },
  { key: 'contact' as const, label: 'A contact' },
];

function TicketForm({ categories, users, contacts, canFileOnBehalf, canPickContact, onSubmit, onCancel, loading, initialValues }: any) {
  const [form, setForm] = useState({ title: '', body: '', categoryId: '', priority: 'MEDIUM', departmentId: '', ...initialValues });
  // Which department the request is raised to — the HR Org Structure list
  // (GET /hr/org/departments is ALL_USERS, so employees can pick too). Orgs
  // with no departments defined simply never see the field.
  const { data: departmentsRes } = useDepartments();
  const departmentOptions = (departmentsRes?.data ?? [])
    .filter((d: any) => d.isActive !== false)
    .map((d: any) => ({ value: d.id, label: d.name }));
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  // "On behalf of" — staff-only (see canFileOnBehalf, gated server-side too
  // in tickets.controller.ts's create()). 'self' sends neither field, so a
  // ticket filed normally is unaffected.
  const [requesterMode, setRequesterMode] = useState<'self' | 'user' | 'contact'>('self');
  const [requesterId, setRequesterId] = useState('');
  const [contactId, setContactId] = useState('');
  const aiDupes = useDetectDuplicates();
  const f = (k: string) => (e: any) => setForm((p: any) => ({ ...p, [k]: e.target.value }));
  const { entityLabel, fieldLabel } = useLabels();
  const singular = entityLabel('ticket', 'singular', 'Ticket');

  useEffect(() => {
    if (form.title.length >= 10) {
      aiDupes.mutate({ title: form.title });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title]);

  /* KB deflection — as the requester describes the problem, look for
     published articles that might already answer it. The query string is
     debounced 450ms so suggestions refresh once per pause, not per keystroke;
     useArticleSuggestions itself stays idle under 4 characters. */
  const [kbQuery, setKbQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setKbQuery(`${form.title} ${form.body}`.trim()), 450);
    return () => clearTimeout(t);
  }, [form.title, form.body]);
  const kbSuggestions = useArticleSuggestions(kbQuery);
  const [openSuggestionId, setOpenSuggestionId] = useState<string | null>(null);

  return (
    <form onSubmit={e => {
      e.preventDefault();
      const onBehalf = requesterMode === 'user' ? { requesterId } : requesterMode === 'contact' ? { contactId } : {};
      onSubmit({ ...form, ...onBehalf, __customFieldValues: customValues });
    }} className="space-y-3">
      <RecordTemplatePicker
        entityType="TICKET"
        onApply={t => {
          setForm((p: any) => ({ ...p, ...t.fieldValues }));
          if (t.customFieldValues) setCustomValues(p => ({ ...p, ...t.customFieldValues as Record<string, string> }));
        }}
      />
      {/* Two columns, as in the reference "Add" forms: who / what / how
          urgent on the left, the long description on the right. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        <div className="space-y-4 min-w-0">
          {canFileOnBehalf && (
            <Field label="Filing for">
              <Tabs
                aria-label="Filing For"
                variant="pill"
                className="mb-2"
                value={requesterMode}
                onChange={setRequesterMode}
                /* "A contact" needs the CRM contact list to pick from, and
                   /crm/contacts is CRM_STAFF-only — an IT agent or manager would
                   get an empty picker backed by a refused request, so the tab is
                   simply not offered to them. */
                items={canPickContact ? FILING_TABS : FILING_TABS.filter(t => t.key !== 'contact')}
              />
              {requesterMode === 'user' && (
                <SearchableSelect ariaLabel="Teammate" value={requesterId} onChange={setRequesterId} required
                  options={(users ?? []).map((u: any) => ({ value: u.id, label: u.name }))} placeholder="— select a teammate —" />
              )}
              {requesterMode === 'contact' && (
                <SearchableSelect ariaLabel="Contact" value={contactId} onChange={setContactId} required
                  options={(contacts ?? []).map((c: any) => ({ value: c.id, label: c.name }))} placeholder="— select a contact —" />
              )}
            </Field>
          )}
          <Field label={fieldLabel('ticket', 'title', 'Title')} required>
            <Input aria-label={fieldLabel('ticket', 'title', 'Title')} required value={form.title} onChange={f('title')} placeholder="Brief description of the issue" />
            <AiNote id="ticket.duplicate" className="mt-1.5" />
            {aiDupes.data?.duplicates && aiDupes.data.duplicates.length > 0 && (
              <Alert tone="warning" className="mt-2">
                <div className="space-y-1">
                  {aiDupes.data.duplicates.map((d: any) => (
                    <p key={d.id}>
                      <span className="font-semibold">Possible duplicate:</span> {d.title}{' '}
                      {/* The model returns confidence on a 0-100 scale (see
                          detectDuplicates in utils/ai.ts) — an older provider
                          returned 0-1, so tolerate both instead of showing
                          "8800% similar". */}
                      <span className="opacity-80">({Math.round(d.confidence > 1 ? d.confidence : d.confidence * 100)}% similar)</span>
                    </p>
                  ))}
                </div>
              </Alert>
            )}
          </Field>
          <Field label="Category">
            <SearchableSelect ariaLabel="Category" value={form.categoryId} onChange={val => setForm((p: any) => ({ ...p, categoryId: val }))} options={(categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label={fieldLabel('ticket', 'priority', 'Priority')}>
            <SearchableSelect ariaLabel={fieldLabel('ticket', 'priority', 'Priority')} value={form.priority} onChange={val => setForm((p: any) => ({ ...p, priority: val }))} required options={PRIORITIES.map(p => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
          </Field>
          {departmentOptions.length > 0 && (
            <Field label="Department" hint="Which department this request is raised to.">
              <SearchableSelect ariaLabel="Department" value={form.departmentId} onChange={val => setForm((p: any) => ({ ...p, departmentId: val }))} options={departmentOptions} placeholder="— none —" />
            </Field>
          )}
        </div>
        <div className="space-y-4 min-w-0">
          <Field label={fieldLabel('ticket', 'description', 'Description')} required>
            <RichTextEditor
              ariaLabel={fieldLabel('ticket', 'description', 'Description')}
              value={form.body}
              onChange={html => setForm((p: any) => ({ ...p, body: html }))}
              placeholder="Provide details about the issue, steps to reproduce, expected vs actual behaviour…"
              minHeight={220}
            />
          </Field>
          {(kbSuggestions.data?.length ?? 0) > 0 && (
            <div className="rounded-card border border-accent/25 bg-accent-soft/40 overflow-hidden">
              <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-2">
                <BookOpen size={13} className="text-accent shrink-0" />
                <p className="text-[12px] font-semibold text-accent-soft-fg">This might already be solved</p>
                <span className="ml-auto text-[11px] text-fg-subtle">from your knowledge base</span>
              </div>
              <ul className="divide-y divide-line-subtle border-t border-line-subtle bg-surface">
                {kbSuggestions.data!.map(s => {
                  const open = openSuggestionId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenSuggestionId(o => (o === s.id ? null : s.id))}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-surface-hover transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-inset"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-fg group-hover:text-accent transition-colors truncate">{s.title}</span>
                          {s.category && <Badge variant="gray">{s.category.name}</Badge>}
                          <ChevronDown size={13} className={`ml-auto shrink-0 text-fg-subtle transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
                        </span>
                        {!open && <span className="block mt-0.5 text-[12px] text-fg-muted line-clamp-2">{s.snippet}</span>}
                      </button>
                      {open && (
                        <div className="px-3.5 pb-3 max-h-56 overflow-y-auto">
                          <RichText content={s.body} className="text-[12.5px] text-fg-muted" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
      <CustomFieldsFormFields
        entityType="TICKET"
        values={customValues}
        onChange={(key, value) => setCustomValues(p => ({ ...p, [key]: value }))}
        // TicketForm only ever creates (edits happen in the detail panel), so
        // defaults always apply here.
        isNew
      />
      <div className="flex justify-end gap-2 pt-4 border-t border-line-subtle">
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={loading}>Submit {singular}</Button>
      </div>
    </form>
  );
}

function TicketEditForm({ ticket, categories, onSaved, onCancel }: any) {
  const updateTicket = useUpdateTicket();
  const { data: departmentsRes } = useDepartments();
  const departmentOptions = (departmentsRes?.data ?? [])
    .filter((d: any) => d.isActive !== false)
    .map((d: any) => ({ value: d.id, label: d.name }));
  const [form, setForm] = useState({
    title: ticket.title || '',
    body: ticket.body || '',
    categoryId: ticket.categoryId || ticket.category?.id || '',
    priority: ticket.priority || 'MEDIUM',
    departmentId: ticket.departmentId || ticket.department?.id || '',
  });
  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));

  async function save() {
    await updateTicket.mutateAsync({ id: ticket.id, ...form });
    onSaved();
  }

  return (
    <Card tone="sunken" padding="sm" flat className="space-y-3">
      <Field label="Title">
        <Input aria-label="Edit title" value={form.title} onChange={f('title')} />
      </Field>
      <Field label="Description">
        <RichTextEditor ariaLabel="Edit description" value={form.body} onChange={html => setForm(p => ({ ...p, body: html }))} minHeight={80} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Category">
          <SearchableSelect ariaLabel="Edit category" value={form.categoryId} onChange={val => setForm(p => ({ ...p, categoryId: val }))} options={(categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} placeholder="— none —" />
        </Field>
        <Field label="Priority">
          <SearchableSelect ariaLabel="Edit priority" value={form.priority} onChange={val => setForm(p => ({ ...p, priority: val }))} options={PRIORITIES.map(p => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
        </Field>
        {departmentOptions.length > 0 && (
          <Field label="Department">
            <SearchableSelect ariaLabel="Edit department" value={form.departmentId} onChange={val => setForm(p => ({ ...p, departmentId: val }))} options={departmentOptions} placeholder="— none —" />
          </Field>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={save} loading={updateTicket.isPending}>Save Changes</Button>
      </div>
    </Card>
  );
}

/** One cell of the ticket summary strip — quiet label, immediate value. */
function SummaryItem({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 px-3.5 py-2.5 ${className}`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle mb-0.5 truncate">{label}</p>
      <div className="text-[12.5px] text-fg font-medium truncate">{children}</div>
    </div>
  );
}

function TicketDetailModal({ id, users, categories }: any) {
  // Own live query keyed by id (not a snapshot prop from the list row) so
  // status/assignee/etc. update in-place the moment a mutation invalidates
  // ['tickets', id] — previously this took `ticket` as a prop sourced from
  // the list array, which only ever refreshed on remount (close + reopen).
  const { data: ticket, isLoading } = useTicket(id);
  const changeStatus = useChangeTicketStatus();
  const assign = useAssignTicket();
  const aiReply = useTicketReply();
  const aiSentiment = useTicketSentiment();
  const aiSummary = useSummarizeThread();
  const aiEstimate = useEstimateResolution();
  const aiSlaRisk = useSlaRisk();
  const aiKb = useKbArticle();
  const createArticle = useCreateArticle();
  /* Which save button is in flight, and what the save produced — the panel
     swaps its action row for a confirmation once the article exists. */
  const [kbSavingAs, setKbSavingAs] = useState<'DRAFT' | 'PUBLISHED' | null>(null);
  const [kbSaved, setKbSaved] = useState<{ id: string; status: string } | null>(null);
  const [kbCopied, setKbCopied] = useState(false);
  const [suggestedReply, setSuggestedReply] = useState('');
  const [copiedReply, setCopiedReply] = useState(false);
  const [autoRouteResult, setAutoRouteResult] = useState<{ categoryName: string | null; agentName: string | null; reason: string } | null>(null);
  const [autoRouting, setAutoRouting] = useState(false);
  const [autoRouteError, setAutoRouteError] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'history'>('details');
  /* Live team-chat thread pinned to this ticket — created lazily server-side
     the first time anyone opens the panel. */
  const recordThread = useRecordThread('TICKET', id);
  const [editingDetails, setEditingDetails] = useState(false);

  if (isLoading || !ticket) {
    return (
      <div className="space-y-4" aria-hidden="true">
        <div className="skeleton h-8 w-2/3" />
        <div className="skeleton h-16 w-full" />
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-24 w-full" />
      </div>
    );
  }
  const slaBreach = ticket.slaDueAt && new Date(ticket.slaDueAt) < new Date() && !['RESOLVED','CLOSED'].includes(ticket.status);
  const sentiment = ticket.sentiment && sentimentConfig[ticket.sentiment];
  const assigneeName = ticket.assignee?.name
    ?? (users ?? []).find((u: any) => u.id === ticket.assignedTo)?.name
    ?? null;

  async function handleAIReply() {
    const data = await aiReply.mutateAsync(ticket.id);
    setSuggestedReply(data.reply);
  }

  async function handleAutoRoute() {
    setAutoRouting(true);
    setAutoRouteError(null);
    try {
      const data = await api.post(`/ai/ticket/${ticket.id}/auto-route`, { apply: true }).then(r => r.data);
      setAutoRouteResult(data);
    } catch (err: any) {
      // Auto-routing used to fail completely silently: the button simply
      // stopped spinning and the ticket was left untouched with no
      // explanation, which is indistinguishable from "the AI had nothing to
      // change". Surface whatever the server said instead.
      setAutoRouteResult(null);
      setAutoRouteError(
        err?.response?.data?.error ||
        err?.message ||
        'Auto-routing failed. The ticket was not changed — try again.'
      );
    } finally { setAutoRouting(false); }
  }

  function copyReply() {
    navigator.clipboard.writeText(suggestedReply);
    setCopiedReply(true);
    setTimeout(() => setCopiedReply(false), 2000);
  }

  return (
    <div className="space-y-4">
      <Tabs
        aria-label="Ticket sections"
        variant="underline"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'details', label: 'Details' },
          { key: 'history', label: `History${ticket.history?.length ? ` (${ticket.history.length})` : ''}` },
        ]}
      />

      {tab === 'history' ? (
        !ticket.history?.length ? (
          <EmptyState
            compact
            icon={<Clock size={20} />}
            title="No status changes yet"
            description="Every status change on this ticket will be recorded here."
          />
        ) : (
          <ol className="animate-fade-in">
            {ticket.history.map((h: any, i: number) => (
              <li key={h.id} className="relative flex items-start gap-3 pb-4 last:pb-0">
                {/* Connecting line between timeline entries */}
                {i < ticket.history.length - 1 && (
                  <span aria-hidden="true" className="absolute left-[9px] top-5 bottom-0 w-px bg-line" />
                )}
                <span className="relative shrink-0 w-[19px] h-[19px] mt-0.5 rounded-full bg-success-soft flex items-center justify-center">
                  <CheckCircle size={12} className="text-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {h.fromStatus && (
                      <>
                        <Badge size="sm" variant={ticketStatusVariant[h.fromStatus] ?? 'gray'}>{h.fromStatus.replace('_',' ')}</Badge>
                        <span className="text-fg-subtle text-[11px]" aria-hidden="true">→</span>
                      </>
                    )}
                    <Badge size="sm" variant={ticketStatusVariant[h.toStatus] ?? 'gray'}>{h.toStatus.replace('_',' ')}</Badge>
                  </div>
                  <p className="text-[11px] text-fg-subtle mt-1">
                    {formatDistanceToNow(new Date(h.changedAt), { addSuffix: true })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )
      ) : (
      <>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge variant={ticketStatusVariant[ticket.status]}>{ticket.status.replace('_',' ')}</Badge>
            <Badge variant={priorityVariant[ticket.priority]}>{humanise(ticket.priority)}</Badge>
            {slaBreach && <Badge variant="red">SLA BREACHED</Badge>}
            {sentiment ? (
              <Badge variant={sentiment.variant}>{sentiment.label}</Badge>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="subtle"
                  icon={<SmilePlus size={11} />}
                  onClick={() => aiSentiment.mutate(ticket.id)}
                  loading={aiSentiment.isPending}
                >
                  {aiSentiment.isPending ? 'Analyzing...' : 'Detect Sentiment'}
                </Button>
                <AiInfo id="ticket.sentiment" />
              </>
            )}
            {!editingDetails && (
              <Button size="xs" variant="secondary" className="ml-auto" icon={<Pencil size={11} />} onClick={() => setEditingDetails(true)}>
                Edit
              </Button>
            )}
          </div>
          {editingDetails ? (
            <TicketEditForm ticket={ticket} categories={categories} onSaved={() => setEditingDetails(false)} onCancel={() => setEditingDetails(false)} />
          ) : (
            <RichText content={ticket.body} className="text-sm text-fg-muted" />
          )}
        </div>
      </div>

      {/* Compact summary strip — requester / assignee / category / SLA / created at a glance */}
      <div className="rounded-card border border-line-subtle bg-surface-sunken grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-line-subtle overflow-hidden">
        <SummaryItem label="Requester">
          <span title={ticket.requester?.name}>{ticket.requester?.name || '--'}</span>
        </SummaryItem>
        <SummaryItem label="Assignee">
          {assigneeName
            ? <span title={assigneeName}>{assigneeName}</span>
            : <span className="text-fg-subtle font-normal">Unassigned</span>}
        </SummaryItem>
        <SummaryItem label="Category">
          <span title={ticket.category?.name}>{ticket.category?.name || '--'}</span>
        </SummaryItem>
        {ticket.department && (
          <SummaryItem label="Department">
            <span title={ticket.department.name}>{ticket.department.name}</span>
          </SummaryItem>
        )}
        <SummaryItem label="SLA Due">
          <span className={`tabular-nums ${slaBreach ? 'text-danger' : ''}`}>
            {ticket.slaDueAt ? formatDistanceToNow(new Date(ticket.slaDueAt), { addSuffix: true }) : '--'}
          </span>
        </SummaryItem>
        <SummaryItem label="Created">
          <span className="tabular-nums">{formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}</span>
        </SummaryItem>
        {ticket.contact && (
          <SummaryItem label="On behalf of (Contact)">
            <span title={ticket.contact.name}>{ticket.contact.name}</span>
          </SummaryItem>
        )}
      </div>

      <RecordTags entityType="TICKET" entityId={ticket.id} />
      <CustomFieldsDisplay entityType="TICKET" entityId={ticket.id} />

      <CardSection title="Update Status">
        <Tabs
          aria-label="Update Status"
          variant="pill"
          value={ticket.status}
          onChange={s => changeStatus.mutate({ id: ticket.id, status: s })}
          items={STATUSES.map(s => ({ key: s, label: s.replace('_',' ') }))}
        />
      </CardSection>
      <CardSection title="Assign To">
        <SearchableSelect ariaLabel="Assign To" value={ticket.assignedTo || ''} onChange={val => assign.mutate({ id: ticket.id, assignedTo: val })} options={(users ?? []).filter((u: any) => ['IT_AGENT','IT_MANAGER','SUPER_ADMIN'].includes(u.role)).map((u: any) => ({ value: u.id, label: u.name }))} placeholder="— unassigned —" />
      </CardSection>

      {/* AI Reply Suggestion */}
      <CardSection
        title="AI Reply Suggestion"
        icon={<Sparkles size={14} className="text-accent" />}
        actions={
          <Button size="sm" variant="secondary" icon={<Sparkles size={12} />} onClick={handleAIReply} loading={aiReply.isPending}>
            {suggestedReply ? 'Regenerate' : 'Suggest Reply'}
          </Button>
        }
      >
        <AiNote id="ticket.reply" className="mb-2.5" />
        {suggestedReply && (
          <Alert
            tone="accent"
            icon={null}
            actions={
              <IconButton
                label="Copy reply"
                tone="accent"
                icon={copiedReply ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                onClick={copyReply}
              />
            }
          >
            <div className="mb-1.5"><AiGeneratedTag /></div>
            <div className="max-h-40 overflow-y-auto"><RichText content={suggestedReply} className="text-sm" /></div>
          </Alert>
        )}
      </CardSection>

      {/* AI Auto-Route */}
      <CardSection
        title="AI Auto-Routing"
        icon={<Route size={14} className="text-info" />}
        actions={
          <Button size="sm" variant="secondary" icon={<Route size={12} />} onClick={handleAutoRoute} loading={autoRouting}>
            {autoRouteResult ? 'Re-route' : 'Auto-Route'}
          </Button>
        }
      >
        {/* Auto-routing reassigns the ticket the moment the button is
            clicked, with no confirmation step — so the explanation is a
            highlighted block rather than a quiet line of helper text. */}
        <div className="rounded-card border border-warning/30 bg-warning-soft px-3 py-2.5 mb-2.5">
          <AiNote id="ticket.autoRoute" />
        </div>
        {autoRouteError && (
          <Alert tone="danger" title="Auto-routing failed" className="mb-2.5" onDismiss={() => setAutoRouteError(null)}>
            {autoRouteError}
          </Alert>
        )}
        {autoRouteResult && (
          <Alert tone="info" title="Routing applied:">
            {autoRouteResult.categoryName && <p>Category -&gt; <span className="font-medium">{autoRouteResult.categoryName}</span></p>}
            {autoRouteResult.agentName && <p>Assigned -&gt; <span className="font-medium">{autoRouteResult.agentName}</span></p>}
            <p className="text-xs mt-1 opacity-80">{autoRouteResult.reason}</p>
          </Alert>
        )}
      </CardSection>

      {/* AI Thread Summary */}
      <CardSection
        title="Thread Summary"
        icon={<Layers size={14} className="text-info" />}
        actions={
          <Button size="sm" variant="secondary" icon={<Sparkles size={12} />} onClick={() => aiSummary.mutate(ticket.id)} loading={aiSummary.isPending}>
            Summarize
          </Button>
        }
      >
        <AiNote id="ticket.summarize" className="mb-2.5" />
        {aiSummary.data?.summary && (
          <Alert tone="info" icon={null}>
            <div className="mb-1.5"><AiGeneratedTag /></div>
            {aiSummary.data.summary}
          </Alert>
        )}
      </CardSection>

      {/* Resolution Time Estimate */}
      <CardSection
        title={<>Resolution Estimate <AiInfo id="ticket.estimate" /></>}
        icon={<Clock size={14} className="text-warning" />}
        actions={
          <Button size="sm" variant="secondary" icon={<Sparkles size={12} />} onClick={() => aiEstimate.mutate(ticket.id)} loading={aiEstimate.isPending}>
            Estimate
          </Button>
        }
      >
        {aiEstimate.data && (
          <Alert tone="warning" title={aiEstimate.data.label}>
            <p className="text-xs opacity-80">{aiEstimate.data.reason}</p>
          </Alert>
        )}
      </CardSection>

      {/* SLA Risk */}
      <CardSection
        title={<>SLA Risk <AiInfo id="ticket.slaRisk" /></>}
        icon={<AlertTriangle size={14} className="text-danger" />}
        actions={
          <Button size="sm" variant="secondary" icon={<Sparkles size={12} />} onClick={() => aiSlaRisk.mutate(ticket.id)} loading={aiSlaRisk.isPending}>
            Assess Risk
          </Button>
        }
      >
        {aiSlaRisk.data && (
          <Alert tone={aiSlaRisk.data.risk === 'HIGH' ? 'danger' : aiSlaRisk.data.risk === 'MEDIUM' ? 'warning' : 'success'}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-bold text-sm">{aiSlaRisk.data.risk} RISK</span>
              <span className="text-xs opacity-70">({aiSlaRisk.data.score}/100)</span>
            </div>
            <p className="text-xs opacity-90">{aiSlaRisk.data.reason}</p>
          </Alert>
        )}
      </CardSection>

      {/* KB Article Generator */}
      <CardSection
        title="Generate KB Article"
        icon={<BookOpen size={14} className="text-success" />}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<Sparkles size={12} />}
            onClick={() => { setKbSaved(null); setKbCopied(false); aiKb.mutate(ticket.id); }}
            loading={aiKb.isPending}
          >
            {aiKb.data ? 'Regenerate' : 'Generate'}
          </Button>
        }
      >
        <AiNote id="ticket.kbArticle" className="mb-2.5" />
        {aiKb.data && (
          <div className="rounded-card border border-line overflow-hidden shadow-ui-sm">
            {/* Draft header — title + provenance tag */}
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-surface-sunken border-b border-line-subtle">
              <BookOpen size={13} className="text-success shrink-0" />
              <p className="text-[13px] font-semibold text-fg truncate">{aiKb.data.title}</p>
              <span className="ml-auto shrink-0"><AiGeneratedTag /></span>
            </div>
            {/* Article body preview */}
            <div className="px-3.5 py-3 max-h-52 overflow-y-auto bg-surface">
              <RichText content={aiKb.data.body} className="text-[12.5px] text-fg-muted" />
            </div>
            {/* Action rail — save into the knowledge base, or copy out */}
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-line-subtle bg-surface-sunken">
              {kbSaved ? (
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-success">
                  <Check size={13} className="shrink-0" />
                  Saved to the knowledge base as {kbSaved.status === 'PUBLISHED' ? 'a published article' : 'a draft'}
                </p>
              ) : (
                <>
                  <Button
                    size="xs"
                    icon={<BookOpen size={11} />}
                    loading={kbSavingAs === 'PUBLISHED'}
                    disabled={kbSavingAs !== null}
                    onClick={async () => {
                      setKbSavingAs('PUBLISHED');
                      try {
                        const a = await createArticle.mutateAsync({ title: aiKb.data!.title, body: aiKb.data!.body, categoryId: ticket.categoryId || undefined, status: 'PUBLISHED' });
                        setKbSaved({ id: a.id, status: a.status });
                      } finally { setKbSavingAs(null); }
                    }}
                  >
                    Save &amp; publish
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    loading={kbSavingAs === 'DRAFT'}
                    disabled={kbSavingAs !== null}
                    onClick={async () => {
                      setKbSavingAs('DRAFT');
                      try {
                        const a = await createArticle.mutateAsync({ title: aiKb.data!.title, body: aiKb.data!.body, categoryId: ticket.categoryId || undefined, status: 'DRAFT' });
                        setKbSaved({ id: a.id, status: a.status });
                      } finally { setKbSavingAs(null); }
                    }}
                  >
                    Save as draft
                  </Button>
                </>
              )}
              <IconButton
                className="ml-auto"
                label="Copy article"
                icon={kbCopied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                onClick={() => {
                  navigator.clipboard.writeText(`# ${aiKb.data!.title}\n\n${aiKb.data!.body}`);
                  setKbCopied(true);
                  setTimeout(() => setKbCopied(false), 1600);
                }}
              />
            </div>
          </div>
        )}
      </CardSection>

      {/* Live technician chat on this ticket — real-time via SSE, and
          "@ai …" summons the assistant for everyone in the thread. */}
      <CardSection title="Team Chat" icon={<MessageCircleMore size={14} className="text-violet-500" />}>
        <div className="rounded-card border border-line-subtle overflow-hidden">
          <ChatThreadView threadId={recordThread.data?.id} compact />
        </div>
      </CardSection>

      {/* 360° view — the requester's contact record plus any custom-module
          records (equipment, jobs, …) whose RELATION field points at this
          ticket. Renders nothing when there are no links. */}
      <CardSection title="Related Records" icon={<Link2 size={14} className="text-accent" />}>
        <RelatedRecords entityType="TICKET" entityId={ticket.id} embedded />
      </CardSection>

      <TimeTrackingPanel ticketId={ticket.id} />
      <ScheduleReminderPanel entityType="TICKET" entityId={ticket.id} />
      <Comments entityType="TICKET" entityId={ticket.id} />
      <Attachments entityType="TICKET" entityId={ticket.id} />
            <RecordTasks entityType="TICKET" entityId={ticket.id} />
      </>
      )}
    </div>
  );
}

export function TicketsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const aiPrefill = useAiPrefill<{ title?: string; body?: string; priority?: string; categoryId?: string }>();

  const { data: tickets, isLoading } = useTickets({
    ...(statusFilter && { status: statusFilter }),
    ...(priorityFilter && { priority: priorityFilter }),
    ...(departmentFilter && { departmentId: departmentFilter }),
  });
  const { data: departmentsRes } = useDepartments();
  const departments = (departmentsRes?.data ?? []).filter((d: any) => d.isActive !== false);
  const { data: categories } = useCategories();
  const { data: users } = useUsers();
  const { user } = useAuth();
  const role = user?.role;
  // Filing on someone else's behalf is IT-staff territory (the server gates it
  // in tickets.controller.ts's create()) — same group as editTickets, read off
  // the shared capability table rather than a local copy of the role names.
  const canFileOnBehalf = can.editTickets(role);
  /* Filing on behalf of a CRM contact needs the contact list, which is
     CRM_STAFF-only — IT_MANAGER/IT_AGENT can file on behalf but cannot read
     /crm/contacts, and EMPLOYEE can do neither. */
  const canPickContact = canFileOnBehalf && can.readCrm(role);
  const { data: contacts } = useContacts(undefined, canPickContact);
  /* /itdesk/tickets/reports is IT_MANAGERS-only, but CRM_MANAGER, IT_AGENT,
     SALES_REP and EMPLOYEE all reach this page. */
  const showReports = can.readTicketReports(role);
  const { data: reports } = useTicketReports(showReports);
  const create = useCreateTicket();
  const saveCustomFields = useSaveCustomFieldValues();
  const { data: ticketFieldDefs } = useCustomFieldDefs('TICKET');

  const filtered = tickets?.filter((t: any) => !search || t.title.toLowerCase().includes(search.toLowerCase()));
  const { entityLabel, fieldLabel } = useLabels();
  const singular = entityLabel('ticket', 'singular', 'Ticket');
  const plural = entityLabel('ticket', 'plural', 'Tickets');

  useEffect(() => {
    // Also close the ticket Detail modal if one happened to be open — it's a
    // separate `selectedId` state from `createModal`, so without this the AI's
    // "Go Create" could leave an existing ticket's detail/edit view stacked
    // on screen alongside (or instead of, visually) the new Create modal.
    if (aiPrefill) { setSelectedId(null); setCreateModal(true); }
  }, [aiPrefill]);

  const columns: Column<any>[] = [
    {
      key: 'title',
      header: fieldLabel('ticket', 'title', 'Title'),
      cell: t => (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[9px] font-bold shrink-0 ${t.priority === 'CRITICAL' ? 'bg-danger' : t.priority === 'HIGH' ? 'bg-warning' : t.priority === 'MEDIUM' ? 'bg-info' : 'bg-line-strong'}`}>{t.priority[0]}</span>
          <span className="font-medium text-fg max-w-[180px] sm:max-w-xs truncate">{t.title}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: fieldLabel('ticket', 'status', 'Status'),
      cell: t => <Badge variant={ticketStatusVariant[t.status]}>{STATUS_LABELS[t.status] ?? t.status.replace('_',' ')}</Badge>,
    },
    {
      key: 'priority',
      header: fieldLabel('ticket', 'priority', 'Priority'),
      cell: t => <Badge variant={priorityVariant[t.priority]}>{humanise(t.priority)}</Badge>,
    },
    {
      key: 'sentiment',
      header: 'Sentiment',
      cell: t => (t.sentiment && sentimentConfig[t.sentiment]
        ? <Badge variant={sentimentConfig[t.sentiment].variant}>{sentimentConfig[t.sentiment].label}</Badge>
        : <span className="text-fg-subtle text-xs">--</span>),
    },
    { key: 'category', header: 'Category', hideBelow: 'md', muted: true, cell: t => t.category?.name || '--' },
    { key: 'department', header: 'Department', hideBelow: 'lg', muted: true, cell: t => t.department?.name || '--' },
    { key: 'requester', header: 'Requester', hideBelow: 'md', muted: true, cell: t => t.requester?.name },
    {
      key: 'assignee',
      header: 'Assigned To',
      muted: true,
      cell: t => t.assignee?.name || <span className="text-fg-subtle">Unassigned</span>,
    },
    {
      key: 'sla',
      header: 'SLA',
      hideBelow: 'md',
      cell: t => {
        const slaBreach = t.slaDueAt && new Date(t.slaDueAt) < new Date() && !['RESOLVED','CLOSED'].includes(t.status);
        return t.slaDueAt ? (
          <span className={`text-xs ${slaBreach ? 'text-danger font-semibold' : 'text-fg-subtle'}`}>
            {slaBreach ? 'Breached' : formatDistanceToNow(new Date(t.slaDueAt), { addSuffix: true })}
          </span>
        ) : <span className="text-fg-subtle text-xs">--</span>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: () => <Pencil size={14} className="text-fg-subtle" />,
    },
  ];

  return (
    <div className="animate-slide-up">
      <PageHeader
        title={plural}
        subtitle={`${filtered?.length ?? 0} ${plural.toLowerCase()}`}
        actions={<Button icon={<Plus size={15} />} onClick={() => setCreateModal(true)}>New {singular}</Button>}
        below={
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder={`Search ${plural.toLowerCase()}...`} className="w-full sm:w-64" />
            <Select aria-label="Status filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s.replace('_',' ')}</option>)}
            </Select>
            <Select aria-label="Priority filter" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
              <option value="">All Priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
            {departments.length > 0 && (
              <Select aria-label="Department filter" value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}>
                <option value="">All Departments</option>
                {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </Toolbar>
        }
      />

      <PageBody>
        {/* Stats come from the IT_MANAGERS-only reports endpoint — for anyone
            else the row is simply not part of their page (no skeleton that
            never resolves). */}
        {showReports && (reports ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatTile label="Open" value={<span className="tabular-nums">{reports.open}</span>} icon={<Ticket size={18} />} />
            <StatTile label="In Progress" value={<span className="tabular-nums">{reports.inProgress}</span>} icon={<Clock size={18} />} />
            <StatTile label="SLA Breached" value={<span className="tabular-nums">{reports.slaBreached}</span>} icon={<AlertCircle size={18} />} />
            <StatTile label="Resolved" value={<span className="tabular-nums">{reports.resolved}</span>} icon={<CheckCircle size={18} />} />
          </div>
        ) : isLoading ? (
          <SkeletonStats />
        ) : null)}

        {isLoading ? (
          <Card padding="none" className="overflow-hidden">
            <DataTable columns={columns} rows={[]} rowKey={(t: any) => t.id} loading />
          </Card>
        ) : filtered?.length === 0 ? (
          <Card padding="none" className="overflow-hidden">
            <EmptyState
              icon={<Ticket size={24} />}
              title={`No ${plural.toLowerCase()} found`}
              description={search || statusFilter || priorityFilter || departmentFilter
                ? 'Nothing matches your current search or filters. Try clearing them.'
                : `All clear! Submit your first ${singular.toLowerCase()} to get started.`}
              action={{ label: `New ${singular}`, onClick: () => setCreateModal(true) }}
            />
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <DataTable
              columns={columns}
              rows={filtered ?? []}
              rowKey={(t: any) => t.id}
              onRowClick={(t: any) => setSelectedId(t.id)}
              minWidth={800}
            />
          </Card>
        )}

      <Modal open={createModal} onClose={() => setCreateModal(false)} title={`Add ${singular}`} subtitle="Raise a request for the IT desk." size="xl">
        <TicketForm categories={categories} users={users} contacts={contacts} canFileOnBehalf={canFileOnBehalf} canPickContact={canPickContact} loading={create.isPending} onCancel={() => setCreateModal(false)}
          initialValues={aiPrefill}
          onSubmit={async (form: any) => {
            const { __customFieldValues, ...rest } = form;
            const created = await create.mutateAsync(rest);
            if (__customFieldValues && ticketFieldDefs?.length) {
              const values = toValuesPayload(ticketFieldDefs, __customFieldValues);
              if (values.length) await saveCustomFields.mutateAsync({ entityId: created.id, values });
            }
            setCreateModal(false);
          }} />
      </Modal>

      <Modal open={!!selectedId} onClose={() => setSelectedId(null)} title={filtered?.find((t: any) => t.id === selectedId)?.title || ''} size="lg">
        <TicketDetailModal id={selectedId} users={users} categories={categories} onClose={() => setSelectedId(null)} />
      </Modal>
      </PageBody>
    </div>
  );
}
