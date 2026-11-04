import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Pencil, Trash2, Mail, Phone } from 'lucide-react';
import { useContacts, useCreateContact, useUpdateContact, useDeleteContact } from '../../../api/crm';
import { useAccounts } from '../../../api/crm';
import { PageHeader, PageBody, Toolbar, Button, Modal, Badge, SearchInput, EmptyState, SearchableSelect, RowActions, CustomFieldsFormFields, RecordTemplatePicker, Card, DataTable, Field, Input, Avatar, Label, FormGrid, FormActions, AccessDenied } from '../../../shared/components';
import type { Column } from '../../../shared/components';
import { useCustomFieldDefs, useCustomFieldValues, useSaveCustomFieldValues, toValuesPayload, fromValueRecords } from '../../../api/customFields';
import { useEffect } from 'react';
import { useLabels } from '../../../hooks/useLabels';
import { useAiPrefill } from '../../../hooks/useAiPrefill';
import { useAuth } from '../../../contexts/AuthContext';
import { can } from '../../../shared/permissions';

function ContactForm({ initial, accounts, entityId, onSubmit, loading, aiPrefill }: any) {
  // Built field-by-field rather than spreading `initial` (the raw Contact
  // record) directly into form state: that used to round-trip extra keys
  // (id, orgId, the nested `account` relation object, ...) back to the
  // server, and — critically — an unset dateOfBirth comes back from Prisma
  // as `null`, which the server previously rejected outright (see
  // contacts.controller.ts's dateOfBirth schema comment), failing the
  // *whole* update including any other field being changed in the same edit.
  const [form, setForm] = useState(initial ? {
    name: initial.name || '',
    email: initial.email || '',
    phone: initial.phone || '',
    jobTitle: initial.jobTitle || '',
    accountId: initial.accountId || initial.account?.id || '',
    source: initial.source || '',
    dateOfBirth: initial.dateOfBirth ? String(initial.dateOfBirth).slice(0, 10) : '',
  } : { name: '', email: '', phone: '', jobTitle: '', accountId: '', source: '', dateOfBirth: '', ...aiPrefill });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const { data: existingValues } = useCustomFieldValues(entityId);
  useEffect(() => {
    if (existingValues) setCustomValues(fromValueRecords(existingValues));
  }, [existingValues]);
  const f = (k: string) => (e: any) => setForm((p: any) => ({ ...p, [k]: e.target.value }));
  const { entityLabel, fieldLabel } = useLabels();
  const singular = entityLabel('contact', 'singular', 'Contact');
  // Fall back to the exact original text when unset, so the e2e suite's
  // getByLabel(/^name$/i) etc. keeps matching for the seeded test org.
  const nameLabel = fieldLabel('contact', 'name', 'Name');
  const phoneLabel = fieldLabel('contact', 'phone', 'Phone');
  const jobTitleLabel = fieldLabel('contact', 'jobTitle', 'Job Title');
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...form, __customFieldValues: customValues }); }} className="space-y-3">
      {!initial && (
        <RecordTemplatePicker
          entityType="CONTACT"
          onApply={t => {
            setForm((p: any) => ({ ...p, ...t.fieldValues }));
            if (t.customFieldValues) setCustomValues(p => ({ ...p, ...t.customFieldValues as Record<string, string> }));
          }}
        />
      )}
      <div className="form-section">
        <p className="form-section-title">Basic Information</p>
        <FormGrid cols={2}>
          <Field label={nameLabel} required>
            <Input aria-label={nameLabel} required value={form.name} onChange={f('name')} placeholder="Full name" />
          </Field>
          <Field label="Email">
            <Input aria-label="Email" type="email" value={form.email} onChange={f('email')} placeholder="email@company.com" />
          </Field>
          <Field label={phoneLabel}>
            <Input aria-label={phoneLabel} value={form.phone} onChange={f('phone')} placeholder="+1 (555) 000-0000" />
          </Field>
          <Field label={jobTitleLabel}>
            <Input aria-label={jobTitleLabel} value={form.jobTitle} onChange={f('jobTitle')} placeholder="e.g. Product Manager" />
          </Field>
          <Field label="Date of Birth" hint="Optional — powers birthday automations under Settings → Workflows.">
            <Input aria-label="Date of Birth" type="date" value={form.dateOfBirth ? String(form.dateOfBirth).slice(0, 10) : ''} onChange={f('dateOfBirth')} />
          </Field>
        </FormGrid>
      </div>
      <div className="form-section">
        <p className="form-section-title">Additional Details</p>
        <FormGrid cols={2}>
          <div>
            <Label>Source</Label>
            <SearchableSelect ariaLabel="Source" value={form.source} onChange={val => setForm((p: any) => ({ ...p, source: val }))} options={['Web','Referral','Cold Outreach','Event','Social Media','Other'].map(s => ({ value: s, label: s }))} />
          </div>
          <div>
            <Label>Account</Label>
            <SearchableSelect ariaLabel="Account" value={form.accountId} onChange={val => setForm((p: any) => ({ ...p, accountId: val }))} options={(accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }))} placeholder="— none —" />
          </div>
        </FormGrid>
      </div>
      <CustomFieldsFormFields
        entityType="CONTACT"
        values={customValues}
        onChange={(key, value) => setCustomValues(p => ({ ...p, [key]: value }))}
        isNew={!entityId}
      />
      <FormActions>
        <Button type="submit" loading={loading}>{initial ? 'Save Changes' : `Create ${singular}`}</Button>
      </FormActions>
    </form>
  );
}

export function ContactsPage() {
  const { user } = useAuth();
  const role = user?.role;
  /* /crm/contacts and /crm/accounts are both CRM_STAFF-only on the server, but
     IT_MANAGER, IT_AGENT and EMPLOYEE can still land here by URL. Ask for
     nothing in that case and show the access screen instead of a page whose
     every request is a guaranteed refusal. */
  const canReadCrm = can.readCrm(role);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<null | 'create' | { type: 'edit'; contact: any }>(null);
  const { data: contacts, isLoading } = useContacts(search ? { search } : undefined, canReadCrm);
  const { data: accounts } = useAccounts(undefined, canReadCrm);
  const create = useCreateContact();
  const update = useUpdateContact();
  const del = useDeleteContact();
  const saveCustomFields = useSaveCustomFieldValues();
  const { data: contactFieldDefs } = useCustomFieldDefs('CONTACT');
  const { entityLabel } = useLabels();
  const singular = entityLabel('contact', 'singular', 'Contact');
  const plural = entityLabel('contact', 'plural', 'Contacts');
  const aiPrefill = useAiPrefill<{ name?: string; email?: string; phone?: string; jobTitle?: string }>();

  useEffect(() => {
    if (aiPrefill) setModal('create');
  }, [aiPrefill]);

  // After every hook — the page itself is unusable without CRM read access.
  if (!canReadCrm) return <AccessDenied />;

  async function handleSubmit(form: any) {
    const { __customFieldValues, ...rest } = form;
    let contactId: string;
    if (modal === 'create') {
      const created = await create.mutateAsync(rest);
      contactId = created.id;
    } else {
      contactId = (modal as any).contact.id;
      await update.mutateAsync({ id: contactId, ...rest });
    }
    if (__customFieldValues && contactFieldDefs?.length) {
      const values = toValuesPayload(contactFieldDefs, __customFieldValues);
      if (values.length) await saveCustomFields.mutateAsync({ entityId: contactId, values });
    }
    setModal(null);
  }

  const contactColumns: Column<any>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (c: any) => (
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={c.name} size="sm" />
          <Link to={`/crm/contacts/${c.id}`} title={c.name} className="font-medium text-fg truncate hover:text-accent hover:underline transition-colors">
            {c.name}
          </Link>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      muted: true,
      cell: (c: any) => c.email && (
        <span className="flex items-center gap-1.5 min-w-0" title={c.email}>
          <Mail size={12} className="shrink-0" /><span className="truncate max-w-[220px]">{c.email}</span>
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      hideBelow: 'sm',
      muted: true,
      cell: (c: any) => c.phone && <span className="flex items-center gap-1.5 tabular-nums whitespace-nowrap"><Phone size={12} className="shrink-0" />{c.phone}</span>,
    },
    { key: 'jobTitle', header: 'Job Title', hideBelow: 'md', muted: true, cell: (c: any) => c.jobTitle && <span className="block max-w-[180px] truncate" title={c.jobTitle}>{c.jobTitle}</span> },
    { key: 'account', header: 'Account', cell: (c: any) => c.account && <Badge variant="blue">{c.account.name}</Badge> },
    { key: 'source', header: 'Source', hideBelow: 'lg', cell: (c: any) => c.source && <Badge>{c.source}</Badge> },
    {
      key: 'actions',
      header: '',
      cell: (c: any) => (
        <RowActions items={[
          { label: 'Edit contact', icon: <Pencil size={14} />, onClick: () => setModal({ type: 'edit', contact: c }) },
          { label: 'Delete contact', icon: <Trash2 size={14} />, onClick: () => del.mutate(c.id), variant: 'danger' },
        ]} />
      ),
    },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={plural}
        subtitle={isLoading ? undefined : `${contacts?.length ?? 0} ${plural.toLowerCase()}`}
        actions={<Button icon={<Plus size={15} />} onClick={() => setModal('create')}>New {singular}</Button>}
        below={
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder={`Search ${plural.toLowerCase()}...`} />
          </Toolbar>
        }
      />

      <PageBody>
        <Card padding="none" className="overflow-hidden">
          <DataTable
            columns={contactColumns}
            rows={contacts ?? []}
            rowKey={(c: any) => c.id}
            minWidth={640}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<Users size={24} />}
                title={search ? `No matching ${plural.toLowerCase()}` : `No ${plural.toLowerCase()} yet`}
                description={search
                  ? 'Nothing matches your search. Try a different name, email or phone number.'
                  : `Add your first ${singular.toLowerCase()}, or convert a lead — converted leads become ${plural.toLowerCase()} automatically.`}
                action={search ? undefined : { label: `New ${singular}`, onClick: () => setModal('create') }}
                secondaryAction={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
              />
            }
          />
        </Card>
      </PageBody>

      <Modal
        open={modal === 'create' || (typeof modal === 'object' && modal !== null && (modal as any).type === 'edit')}
        onClose={() => setModal(null)}
        title={modal === 'create' ? `New ${singular}` : `Edit ${singular}`}
      >
        <ContactForm
          initial={modal && typeof modal === 'object' && (modal as any).type === 'edit' ? (modal as any).contact : null}
          entityId={modal && typeof modal === 'object' && (modal as any).type === 'edit' ? (modal as any).contact.id : undefined}
          accounts={accounts}
          onSubmit={handleSubmit}
          loading={create.isPending || update.isPending}
          aiPrefill={modal === 'create' ? aiPrefill : null}
        />
      </Modal>
    </div>
  );
}
