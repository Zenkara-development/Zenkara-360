import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Mail, Phone, Briefcase, Building2, Globe,
  TrendingUp, Calendar, CheckCircle, Clock, Plus, Pencil, Sparkles, ShieldAlert,
} from 'lucide-react';
import { SearchableSelect, RecordTasks, RecordTags, RelatedRecords } from '../../../shared/components';
import { useContact, useUpdateContact, useAccounts, useCreateActivity } from '../../../api/crm';
import { useChurnRisk } from '../../../api/ai';
import {
  PageHeader, PageBody, Badge, Button, Modal, EmptyState, CustomFieldsDisplay, CustomFieldsFormFields,
  Card, CardHeader, CardSection, SkeletonCard, Field, Input, Textarea, Label, Avatar, Alert, FormActions, AiNote,
  AccessDenied,
} from '../../../shared/components';
import { Comments } from '../../../shared/components/Comments';
import { Attachments } from '../../../shared/components/Attachments';
import { useCustomFieldDefs, useCustomFieldValues, useSaveCustomFieldValues, toValuesPayload, fromValueRecords } from '../../../api/customFields';
import { useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useFormat } from '../../../hooks/useFormat';
import { useAuth } from '../../../contexts/AuthContext';
import { can } from '../../../shared/permissions';

const DEAL_STAGE_COLOR: Record<string, string> = {
  Prospecting: 'gray', Proposal: 'blue', Negotiation: 'yellow', Won: 'green', Lost: 'red',
};

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  CALL:    <Phone size={14} />,
  EMAIL:   <Mail size={14} />,
  MEETING: <Calendar size={14} />,
  TASK:    <CheckCircle size={14} />,
  NOTE:    <Briefcase size={14} />,
};

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="text-fg-subtle flex-shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-fg-subtle">{label}</p>
        <p className="text-fg font-medium">{value}</p>
      </div>
    </div>
  );
}

function ActivityForm({ contactId, onSubmit, loading }: any) {
  // Field keys match the backend Activity schema (title/body), not the
  // display labels (Subject/Notes) — previously these were named
  // subject/notes here, which silently failed server-side validation
  // (title is a required field) since the mismatched keys were never
  // translated before being POSTed.
  const [form, setForm] = useState({ type: 'CALL', title: '', body: '', dueAt: '' });
  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...form, contactId }); }} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Type</Label>
          <SearchableSelect ariaLabel="Type" value={form.type} onChange={val => setForm(p => ({ ...p, type: val }))} required options={['CALL','EMAIL','MEETING','TASK','NOTE'].map(t => ({ value: t, label: t }))} />
        </div>
        <Field label="Due Date">
          <Input type="datetime-local" value={form.dueAt} onChange={f('dueAt')} />
        </Field>
      </div>
      <Field label="Subject" required>
        <Input aria-label="Subject" required value={form.title} onChange={f('title')} placeholder="Call to discuss renewal..." />
      </Field>
      <Field label="Notes">
        <Textarea rows={3} value={form.body} onChange={f('body')} placeholder="Details..." />
      </Field>
      <FormActions>
        <Button type="submit" loading={loading}>Log Activity</Button>
      </FormActions>
    </form>
  );
}

function EditContactForm({ contact, accounts, onSubmit, loading }: any) {
  const [form, setForm] = useState({
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    jobTitle: contact.jobTitle || '',
    source: contact.source || '',
    accountId: contact.account?.id || '',
  });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const { data: existingValues } = useCustomFieldValues(contact.id);
  useEffect(() => {
    if (existingValues) setCustomValues(fromValueRecords(existingValues));
  }, [existingValues]);
  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...form, __customFieldValues: customValues }); }} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name" required><Input aria-label="Name" required value={form.name} onChange={f('name')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={f('email')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={f('phone')} /></Field>
        <Field label="Job Title"><Input value={form.jobTitle} onChange={f('jobTitle')} /></Field>
        <div>
          <Label>Source</Label>
          <SearchableSelect ariaLabel="Source" value={form.source} onChange={val => setForm(p => ({ ...p, source: val }))} options={['Web','Referral','Cold Outreach','Event','Social Media','Other'].map(s => ({ value: s, label: s }))} />
        </div>
        <div>
          <Label>Account</Label>
          <SearchableSelect ariaLabel="Account" value={form.accountId} onChange={val => setForm(p => ({ ...p, accountId: val }))} options={(accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }))} placeholder="— none —" />
        </div>
      </div>
      <CustomFieldsFormFields
        entityType="CONTACT"
        values={customValues}
        onChange={(key, value) => setCustomValues(p => ({ ...p, [key]: value }))}
      />
      <FormActions><Button type="submit" loading={loading}>Save Changes</Button></FormActions>
    </form>
  );
}

const CHURN_RISK_TONE = { HIGH: 'danger', MEDIUM: 'warning' } as const;
const CHURN_RISK_VARIANT = { HIGH: 'red', MEDIUM: 'yellow' } as const;

function ChurnRiskCard({ contactId }: { contactId: string }) {
  const churnRisk = useChurnRisk();
  const risk = churnRisk.data?.risk as keyof typeof CHURN_RISK_TONE | undefined;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wider flex items-center gap-1.5">
          <ShieldAlert size={13} /> Churn Risk
        </p>
        <Button size="sm" variant="secondary" icon={<Sparkles size={12} />} onClick={() => churnRisk.mutate(contactId)} loading={churnRisk.isPending}>
          Assess
        </Button>
      </div>
      <AiNote id="contact.churnRisk" />
      {churnRisk.data && (
        <Alert tone={(risk && CHURN_RISK_TONE[risk]) || 'success'} icon={null}>
          <div className="flex items-center gap-2 mb-1.5">
            <Badge variant={(risk && CHURN_RISK_VARIANT[risk]) || 'green'}>
              {churnRisk.data.risk} RISK
            </Badge>
            <span className="text-fg-subtle text-xs">({churnRisk.data.score}/100)</span>
          </div>
          <p className="text-xs text-fg-muted leading-relaxed">{churnRisk.data.reason}</p>
        </Alert>
      )}
    </Card>
  );
}

export function ContactDetailPage() {
  const { money, dateTime } = useFormat();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  /* GET /crm/contacts/:id and /crm/accounts are CRM_STAFF-only — the same
     guard as the list page this is reached from, and reachable by URL from
     roles that have neither. */
  const canReadCrm = can.readCrm(user?.role);
  const { data: contact, isLoading } = useContact(id!, canReadCrm);
  const { data: accounts } = useAccounts(undefined, canReadCrm);
  const update = useUpdateContact();
  const createActivity = useCreateActivity();
  const saveCustomFields = useSaveCustomFieldValues();
  const { data: contactFieldDefs } = useCustomFieldDefs('CONTACT');
  const [activityModal, setActivityModal] = useState(false);
  const [editModal, setEditModal] = useState(false);

  // After every hook.
  if (!canReadCrm) return <AccessDenied />;

  if (isLoading) {
    return (
      <PageBody width="full" className="max-w-5xl mx-auto animate-fade-in">
        <div className="skeleton h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <SkeletonCard lines={6} />
            <SkeletonCard lines={4} />
          </div>
          <div className="lg:col-span-2 space-y-5">
            <SkeletonCard lines={4} />
            <SkeletonCard lines={7} />
          </div>
        </div>
      </PageBody>
    );
  }
  if (!contact) {
    return (
      <PageBody width="narrow">
        <EmptyState
          icon={<Briefcase size={24} />}
          title="Contact not found"
          description="It may have been deleted, or the link is out of date."
          action={{ label: 'Back to Contacts', onClick: () => navigate('/crm/contacts') }}
        />
      </PageBody>
    );
  }

  const totalDealValue = contact.deals?.reduce((s: number, d: any) => s + Number(d.value || 0), 0) ?? 0;
  const openDeals = contact.deals?.filter((d: any) => !['Won','Lost'].includes(d.stage)) ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumb="Contacts"
        title={contact.name}
        subtitle={contact.jobTitle || undefined}
        actions={
          <>
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => navigate('/crm/contacts')}>
              Back
            </Button>
            <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditModal(true)}>Edit</Button>
          </>
        }
        below={
          <div className="flex items-center gap-2 flex-wrap">
            {contact.account && <Badge variant="blue">{contact.account.name}</Badge>}
            {contact.source && <Badge>{contact.source}</Badge>}
            <RecordTags entityType="CONTACT" entityId={contact.id} />
          </div>
        }
      />

      <PageBody width="full" className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={contact.name} size="lg" tone="accent" />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-fg truncate" title={contact.name}>{contact.name}</p>
                {contact.jobTitle && <p className="text-xs text-fg-muted truncate" title={contact.jobTitle}>{contact.jobTitle}</p>}
              </div>
            </div>
            <CardSection className="space-y-4">
              <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">Contact Info</p>
              <InfoRow icon={<Mail size={14} />} label="Email" value={contact.email} />
              <InfoRow icon={<Phone size={14} />} label="Phone" value={contact.phone} />
              <InfoRow icon={<Briefcase size={14} />} label="Job Title" value={contact.jobTitle} />
              <InfoRow icon={<Building2 size={14} />} label="Account" value={contact.account?.name} />
              <InfoRow icon={<Globe size={14} />} label="Source" value={contact.source} />
              <InfoRow icon={<Clock size={14} />} label="Added" value={formatDistanceToNow(new Date(contact.createdAt), { addSuffix: true })} />
            </CardSection>
          </Card>

          <Card className="space-y-3">
            <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">Pipeline Summary</p>
            <div>
              <p className="text-2xl font-semibold text-success tabular-nums tracking-tight">{money(totalDealValue)}</p>
              <p className="text-xs text-fg-subtle">Total pipeline value</p>
            </div>
            <div className="flex gap-6">
              <div>
                <p className="text-lg font-semibold text-fg tabular-nums">{contact.deals?.length ?? 0}</p>
                <p className="text-xs text-fg-subtle">Total deals</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-accent tabular-nums">{openDeals.length}</p>
                <p className="text-xs text-fg-subtle">Open deals</p>
              </div>
            </div>
          </Card>

          <ChurnRiskCard contactId={contact.id} />
        </div>

        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><TrendingUp size={15} /> Deals</span>}
              actions={<Link to="/crm/deals" className="text-xs text-accent hover:underline">View pipeline</Link>}
              className="mb-4"
            />
            {!contact.deals?.length ? (
              <EmptyState
                compact
                icon={<TrendingUp size={20} />}
                title="No deals yet"
                description="Deals linked to this contact will appear here. Create one from the pipeline."
              />
            ) : (
              <div className="space-y-2">
                {contact.deals.map((deal: any) => (
                  <div key={deal.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-card bg-surface-sunken hover:bg-surface-hover transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate" title={deal.title}>{deal.title}</p>
                      <p className="text-xs text-fg-subtle">{deal.assignee?.name || 'Unassigned'}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {deal.value > 0 && <span className="text-sm font-semibold text-success tabular-nums">{money(Number(deal.value))}</span>}
                      <Badge variant={DEAL_STAGE_COLOR[deal.stage] as any || 'gray'}>{deal.stage}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Calendar size={15} /> Activity Timeline</span>}
              actions={<Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setActivityModal(true)}>Log Activity</Button>}
              className="mb-4"
            />
            {!contact.activities?.length ? (
              <EmptyState icon={<Calendar size={20} />} title="No activities yet"
                description="Log a call, email, or meeting to start tracking"
                action={{ label: 'Add Activity', onClick: () => setActivityModal(true) }} />
            ) : (
              <div className="relative max-h-96 overflow-y-auto">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-line-subtle" />
                <div className="space-y-4">
                  {contact.activities.map((a: any) => (
                    <div key={a.id} className="flex gap-4 relative">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                        a.status === 'DONE' ? 'bg-success-soft text-success-fg' : 'bg-accent-soft text-accent-soft-fg'
                      }`}>
                        {ACTIVITY_ICON[a.type] || <Briefcase size={14} />}
                      </div>
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <p className="text-sm font-medium text-fg">{a.title}</p>
                          <span className="text-xs text-fg-subtle flex-shrink-0">
                            {a.dueAt ? dateTime(a.dueAt) : formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        {a.body && <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">{a.body}</p>}
                        <p className="text-xs text-fg-subtle mt-0.5">{a.createdByUser?.name} · <span className="uppercase">{a.type}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* 360° view — every record linked to this contact: leads, tickets,
              quotes/invoices via their deals, and custom-module records whose
              RELATION field points here. Deals are excluded since the card
              above already renders them richer. */}
          <RelatedRecords entityType="CONTACT" entityId={contact.id} exclude={['deals']} />

          <CustomFieldsDisplay entityType="CONTACT" entityId={contact.id} card />

          <Card>
            <Comments entityType="CONTACT" entityId={contact.id} />
            <Attachments entityType="CONTACT" entityId={contact.id} />
            <RecordTasks entityType="CONTACT" entityId={contact.id} />
          </Card>
        </div>
      </div>
      </PageBody>

      <Modal open={activityModal} onClose={() => setActivityModal(false)} title="Log Activity">
        <ActivityForm contactId={contact.id} loading={createActivity.isPending}
          onSubmit={async (form: any) => {
            // Only close on success — previously a `finally` closed the modal
            // even when the create request failed, silently discarding the
            // error (and the activity) with no feedback to the user.
            await createActivity.mutateAsync({ ...form, dueAt: form.dueAt || undefined });
            setActivityModal(false);
          }} />
      </Modal>

      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Contact">
        <EditContactForm contact={contact} accounts={accounts} loading={update.isPending}
          onSubmit={async (form: any) => {
            const { __customFieldValues, ...rest } = form;
            await update.mutateAsync({ id: contact.id, ...rest });
            if (__customFieldValues && contactFieldDefs?.length) {
              const values = toValuesPayload(contactFieldDefs, __customFieldValues);
              if (values.length) await saveCustomFields.mutateAsync({ entityId: contact.id, values });
            }
            setEditModal(false);
          }} />
      </Modal>
    </div>
  );
}
