import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Plus, Trash2, Pencil, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import {
  useModuleRecordsFull, useCreateModuleRecord, useUpdateModuleRecord, useDeleteModuleRecord,
  useRelatedRecords,
} from '../../api/customModules';
import {
  Button, Modal, Spinner, EmptyState, SearchableSelect, RowActions,
  Field, Input, Textarea, Checkbox, DataTable, Badge, FormError, type Column,
} from './index';
import { STAGE_DOT, type ModuleStage } from './CustomModuleKanban';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../permissions';

// Extracted out of pages/CustomModulesPage.tsx (the module builder) so the
// same records table + form can also be embedded standalone on a module's
// own nav-linked page (pages/CustomModuleViewPage.tsx) — day-to-day record
// entry shouldn't require going through the admin builder UI to get there.

/** Bounded pickers over core records for entity-target RELATION fields. */
const CORE_ENTITY_SOURCES: Record<string, { url: string; title: (r: any) => string }> = {
  CONTACT: { url: '/crm/contacts', title: r => r.name },
  ACCOUNT: { url: '/crm/accounts', title: r => r.name },
  DEAL:    { url: '/crm/deals',    title: r => r.title },
  TICKET:  { url: '/itdesk/tickets', title: r => r.title },
};

function useCoreEntityOptions(entity?: string) {
  const src = entity ? CORE_ENTITY_SOURCES[entity] : undefined;
  return useQuery({
    queryKey: ['core-relation-options', entity],
    queryFn: () => api.get(src!.url, { params: { limit: 100 } }).then(r => {
      const rows: any[] = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      return rows.map(row => ({ value: row.id, label: src!.title(row) ?? row.id }));
    }),
    enabled: !!src,
    staleTime: 60_000,
  });
}

/** RELATION input — a searchable picker over the target's records: another
 *  custom module's, or a core entity's (contacts, accounts, deals, tickets). */
function RelationInput({ field, value, onChange }: { field: any; value: any; onChange: (v: any) => void }) {
  // The target module's records, titled server-side. Fine to fetch lazily
  // per open form — it's one bounded (limit 100) list per relation field.
  const { data } = useModuleRecordsFull(field.relationModuleId ?? undefined);
  const { data: coreOptions } = useCoreEntityOptions(field.relationEntity ?? undefined);
  const options = field.relationEntity
    ? (coreOptions ?? [])
    : (data?.rows ?? []).map((r: any) => ({ value: r.id, label: r.title ?? r.id }));
  return (
    <SearchableSelect
      ariaLabel={field.label}
      value={value ?? ''}
      onChange={onChange}
      options={options}
      placeholder={`Link a record…`}
    />
  );
}

function RecordFieldInput({ field, value, onChange }: { field: any; value: any; onChange: (v: any) => void }) {
  const label = field.label;
  if (field.fieldType === 'RELATION') {
    return <RelationInput field={field} value={value} onChange={onChange} />;
  }
  if (field.fieldType === 'BOOLEAN') {
    return <Checkbox label={label} checked={!!value} onChange={e => onChange(e.target.checked)} />;
  }
  if (field.fieldType === 'DROPDOWN') {
    return <SearchableSelect ariaLabel={label} value={value ?? ''} onChange={onChange} options={(field.options ?? []).map((o: string) => ({ value: o, label: o }))} placeholder={`Select ${label}…`} />;
  }
  if (field.fieldType === 'DATE') {
    return <Input aria-label={label} type="date" value={value ? String(value).slice(0, 10) : ''} onChange={e => onChange(e.target.value)} />;
  }
  if (field.fieldType === 'NUMBER' || field.fieldType === 'CURRENCY') {
    return <Input aria-label={label} type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  }
  if (field.fieldType === 'TEXTAREA') {
    return <Textarea aria-label={label} rows={2} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  }
  return <Input aria-label={label} type={field.fieldType === 'EMAIL' ? 'email' : 'text'} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
}

/** Records elsewhere pointing at this one — "Service Jobs (via Vehicle): …". */
function RelatedRecordsPanel({ moduleId, recordId }: { moduleId: string; recordId: string }) {
  const { data } = useRelatedRecords(moduleId, recordId);
  if (!data?.groups?.length) return null;
  return (
    <div className="rounded-card border border-line-subtle bg-surface-sunken/50 p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
        <Link2 size={12} className="text-accent" /> Linked records
      </p>
      {data.groups.map(g => (
        <div key={`${g.module.id}:${g.viaField}`}>
          <p className="text-[11px] font-medium text-fg-muted uppercase tracking-wide">
            {g.module.name} <span className="normal-case font-normal text-fg-subtle">via {g.viaField}</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {g.records.map(r => (
              <Link
                key={r.id}
                to={`/modules/${g.module.slug}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-btn border border-line bg-surface text-[11.5px] text-fg hover:border-line-strong hover:bg-surface-hover transition-colors"
              >
                {r.title}
                {r.stage && <span className="text-fg-subtle">· {r.stage.replace(/[-_]/g, ' ')}</span>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecordFormModal({ module_, record, initialStage, onClose }: {
  module_: any; record: any | null; initialStage?: string; onClose: () => void;
}) {
  const create = useCreateModuleRecord();
  const update = useUpdateModuleRecord();
  const [data, setData] = useState<Record<string, unknown>>(record?.data ?? {});
  const [stage, setStage] = useState<string | undefined>(record?.stage ?? initialStage);
  const [error, setError] = useState('');
  const loading = create.isPending || update.isPending;
  const stages: ModuleStage[] = Array.isArray(module_.stages) ? module_.stages : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (record) await update.mutateAsync({ moduleId: module_.id, recordId: record.id, data });
      else await create.mutateAsync({ moduleId: module_.id, data, stage });
      // Close on success only. Previously both calls were awaited with no
      // catch, so a rejected save (a required field the server rejects, a
      // dropped connection) surfaced as an unhandled rejection: the modal
      // just sat there, and the user had no idea the record was not created.
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not save this record. Check the required fields and try again.');
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Record' : `New ${module_.name} Record`}>
      <form onSubmit={submit} className="space-y-4">
        <FormError>{error}</FormError>
        {/* New records on a pipeline module pick their starting stage here;
            existing records move stages on the board, not in this form. */}
        {!record && stages.length > 0 && (
          <Field label="Stage">
            <SearchableSelect
              ariaLabel="Stage"
              value={stage ?? stages[0].key}
              onChange={v => setStage(v)}
              options={stages.map(s => ({ value: s.key, label: s.label }))}
            />
          </Field>
        )}
        {(module_.fields ?? []).map((f: any) => (
          f.fieldType === 'BOOLEAN' ? (
            <RecordFieldInput key={f.id} field={f} value={data[f.fieldKey]} onChange={v => setData(p => ({ ...p, [f.fieldKey]: v }))} />
          ) : (
            <Field key={f.id} label={f.label} required={f.required}>
              <RecordFieldInput field={f} value={data[f.fieldKey]} onChange={v => setData(p => ({ ...p, [f.fieldKey]: v }))} />
            </Field>
          )
        ))}
        {record && <RelatedRecordsPanel moduleId={module_.id} recordId={record.id} />}
        <div className="flex justify-end pt-1"><Button type="submit" loading={loading}>{record ? 'Save Changes' : 'Create Record'}</Button></div>
      </form>
    </Modal>
  );
}

/** Records table + add/edit/delete for one custom module. `module_` must include its `fields` array (from useCustomModule, not the list endpoint). */
export function CustomModuleRecordsTab({ module_, canDelete = true }: { module_: any; canDelete?: boolean }) {
  /* /custom-modules/:id/records is ALL_STAFF on the server. An EMPLOYEE can
     neither list nor create records, so the tab asks for nothing and says so
     quietly instead of showing an empty table with an Add button that only
     ever produces a refusal. */
  const { user } = useAuth();
  const canReadRecords = can.readStaffRecords(user?.role);
  const { data: full, isLoading } = useModuleRecordsFull(module_.id, canReadRecords);
  const rows: any[] = full?.rows ?? [];
  const relationTitles = full?.relationTitles ?? {};
  const deleteRecord = useDeleteModuleRecord();
  const [recordModal, setRecordModal] = useState<null | 'new' | any>(null);
  const stages: ModuleStage[] = Array.isArray(module_.stages) ? module_.stages : [];

  /* Column set follows the module's own listColumns config (Phase 2) when
     set; otherwise the first 5 fields, as before. Full record in the modal. */
  const allFields: any[] = module_.fields ?? [];
  const configured: string[] = Array.isArray(module_.listColumns) ? module_.listColumns : [];
  const fields = configured.length
    ? configured.map(k => allFields.find(f => f.fieldKey === k)).filter(Boolean)
    : allFields.slice(0, 5);

  function cellValue(r: any, f: any): React.ReactNode {
    const v = r.data[f.fieldKey];
    if (f.fieldType === 'BOOLEAN') return v ? 'Yes' : 'No';
    if (f.fieldType === 'RELATION') return v ? (relationTitles[String(v)] ?? '—') : '—';
    if (f.fieldType === 'DATE' && v) return String(v).slice(0, 10);
    return String(v ?? '—');
  }

  const columns: Column<any>[] = [
    ...fields.map((f: any) => ({
      key: f.id,
      header: f.label,
      cell: (r: any) => cellValue(r, f),
    })),
    // Pipeline modules show where each record sits, matching the board.
    ...(stages.length ? [{
      key: '__stage', header: 'Stage',
      cell: (r: any) => {
        const s = stages.find(x => x.key === r.stage) ?? stages[0];
        return (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-fg">
            <span className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[s?.color ?? ''] ?? 'bg-slate-400'}`} aria-hidden />
            {s?.label ?? '—'}
          </span>
        );
      },
    } satisfies Column<any>] : []),
    {
      key: '__source', header: 'Source',
      cell: (r: any) => <Badge variant={r.source === 'SYNC' ? 'indigo' : 'gray'}>{r.source}</Badge>,
    },
    {
      key: '__actions', header: '', width: 56,
      cell: (r: any) => (
        <RowActions items={[
          { label: 'Edit record', icon: <Pencil size={14} />, onClick: () => setRecordModal(r) },
          { label: 'Delete record', icon: <Trash2 size={14} />, onClick: () => deleteRecord.mutate({ moduleId: module_.id, recordId: r.id }), variant: 'danger', hidden: !canDelete },
        ]} />
      ),
    },
  ];

  // After every hook, never before one.
  if (!canReadRecords) {
    return (
      <EmptyState
        icon={<Layers size={22} />}
        title="Records aren't available for your role"
        description="Ask an administrator if you need access to this module's records."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus size={13} />} onClick={() => setRecordModal('new')} disabled={!module_.fields?.length}>Add Record</Button>
      </div>
      {!module_.fields?.length ? (
        <EmptyState icon={<Layers size={22} />} title="Add fields first" description="Define at least one field before creating records" />
      ) : isLoading ? <Spinner /> : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r: any) => r.id}
          minWidth={560}
          empty={<EmptyState icon={<Layers size={22} />} title="No records yet" description="Add one manually, or connect a sync in the Sync tab" />}
        />
      )}
      {recordModal && <RecordFormModal module_={module_} record={recordModal === 'new' ? null : recordModal} onClose={() => setRecordModal(null)} />}
    </div>
  );
}
