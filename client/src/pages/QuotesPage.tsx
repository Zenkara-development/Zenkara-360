import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  RowActions, SearchableSelect, PageHeader, PageBody, Button, IconButton, Modal, Card, StatusBadge,
  EmptyState, Field, Input, FormGrid, SkeletonCard, RecordTasks, RecordTags, AccessDenied} from '../shared/components';
import { Attachments } from '../shared/components/Attachments';
import { FileText, Plus, Pencil, Trash2, Send, CheckCircle, XCircle, LayoutTemplate, Link2, Check as CheckIcon } from 'lucide-react';
import { useQuoteTemplates } from '../api/templates';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

interface QuoteLine { id?: string; description: string; quantity: number; unitPrice: number; }
interface Quote {
  // Was absent, so `q.notes` did not typecheck and openEdit sent '' instead —
  // which the server happily wrote over the real note.
  notes?: string | null;
  id: string;
  title: string;
  status: string;
  total: number;
  validUntil: string | null;
  createdAt: string;
  deal?: { title: string } | null;
  lines: QuoteLine[];
}

const STATUS_VARIANT = {
  DRAFT: 'gray', SENT: 'blue', ACCEPTED: 'green', REJECTED: 'red',
} as const;

const EMPTY_LINE: QuoteLine = { description: '', quantity: 1, unitPrice: 0 };

export default function QuotesPage() {
  const qc = useQueryClient();
  const { money, date } = useFormat();
  const { user } = useAuth();
  const role = user?.role;
  /* /quotes is CRM_STAFF-only and /templates/quotes is ALL_STAFF-only — two
     different guards, so they get two different flags rather than one. */
  const canReadQuotes = can.readQuotesInvoices(role);
  const canReadTemplates = can.manageTemplates(role);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [form, setForm] = useState({ title: '', validUntil: '', notes: '', lines: [{ ...EMPTY_LINE }] });

  const { data: quotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ['quotes'],
    queryFn: () => api.get('/quotes').then(r => Array.isArray(r.data) ? r.data : (r.data.data ?? [])),
    enabled: canReadQuotes,
  });
  const { data: quoteTemplates } = useQuoteTemplates(canReadTemplates);

  const save = useMutation({
    mutationFn: (body: typeof form) =>
      editing
        ? api.patch(`/quotes/${editing.id}`, body).then(r => r.data)
        : api.post('/quotes', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotes'] }); closeModal(); },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/quotes/${id}/status`, { status }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/quotes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // After every hook.
  if (!canReadQuotes) return <AccessDenied />;

  async function copyShareLink(id: string) {
    try {
      const { data } = await api.get(`/quotes/${id}/share-link`);
      await navigator.clipboard.writeText(data.link);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { alert('Could not generate share link.'); }
  }

  function openCreate() {
    setEditing(null);
    setForm({ title: '', validUntil: '', notes: '', lines: [{ ...EMPTY_LINE }] });
    setShowModal(true);
  }

  function openEdit(q: Quote) {
    setEditing(q);
    setForm({
      title: q.title,
      validUntil: q.validUntil ? q.validUntil.split('T')[0] : '',
      notes: q.notes ?? '',
      lines: q.lines.map(l => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    });
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function updateLine(i: number, field: keyof QuoteLine, value: string | number) {
    setForm(f => {
      const lines = [...f.lines];
      lines[i] = { ...lines[i], [field]: value };
      return { ...f, lines };
    });
  }

  function addLine() { setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] })); }
  function removeLine(i: number) { setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) })); }

  const lineTotal = form.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Quotes & Proposals"
        subtitle="Create and manage sales quotes"
        actions={<Button icon={<Plus size={16} />} onClick={openCreate}>New Quote</Button>}
      />

      <PageBody width="full" className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <>
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
          </>
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={<FileText size={24} />}
            title="No quotes yet"
            description="Draft a proposal with line items, then share a secure link your customer can accept and e-sign."
            action={{ label: 'New Quote', onClick: openCreate }}
          />
        ) : (
          quotes.map(q => (
            <Card key={q.id} data-testid="quote-card" className="hover:shadow-ui-md transition-shadow">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-fg truncate" title={q.title}>{q.title}</h3>
                    <StatusBadge value={q.status} map={STATUS_VARIANT} dot />
                  </div>
                  {q.deal && <p className="text-xs text-fg-muted truncate" title={q.deal.title}>Deal: {q.deal.title}</p>}
                  <p className="text-xs text-fg-subtle mt-0.5">{date(q.createdAt)}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center justify-end gap-1 text-xl font-semibold text-fg tabular-nums tracking-tight">
                    {money(q.lines?.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0) ?? 0)}
                  </div>
                  {q.validUntil && (
                    <p className="text-xs text-fg-subtle">Valid until {date(q.validUntil)}</p>
                  )}
                </div>
              </div>

              {/* Line preview */}
              {q.lines?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-line-subtle">
                  <div className="space-y-1">
                    {q.lines.slice(0, 3).map((l, i) => (
                      <div key={i} className="flex justify-between gap-3 text-xs text-fg-muted">
                        <span className="truncate" title={l.description}>{l.description} × {Number(l.quantity)}</span>
                        <span className="tabular-nums shrink-0">{money(Number(l.quantity) * Number(l.unitPrice))}</span>
                      </div>
                    ))}
                    {q.lines.length > 3 && <p className="text-xs text-fg-subtle">+{q.lines.length - 3} more items</p>}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {q.status === 'DRAFT' && (
                  <Button size="xs" variant="subtle" icon={<Send size={12} />}
                    onClick={() => changeStatus.mutate({ id: q.id, status: 'SENT' })}>
                    Send
                  </Button>
                )}
                {q.status === 'SENT' && (
                  <>
                    <Button size="xs" variant="subtle" icon={<CheckCircle size={12} />}
                      onClick={() => changeStatus.mutate({ id: q.id, status: 'ACCEPTED' })}>
                      Accept
                    </Button>
                    <Button size="xs" variant="danger" icon={<XCircle size={12} />}
                      onClick={() => changeStatus.mutate({ id: q.id, status: 'REJECTED' })}>
                      Reject
                    </Button>
                  </>
                )}
                {(q.status === 'SENT' || q.status === 'ACCEPTED') && (
                  <Button size="xs" variant="secondary"
                    icon={copiedId === q.id ? <CheckIcon size={12} /> : <Link2 size={12} />}
                    onClick={() => copyShareLink(q.id)}>
                    {copiedId === q.id ? 'Copied' : 'Copy customer link'}
                  </Button>
                )}
                <RowActions items={[
                  { label: 'Edit quote', icon: <Pencil size={14} />, onClick: () => openEdit(q), hidden: q.status !== 'DRAFT' },
                  { label: 'Delete quote', icon: <Trash2 size={14} />, onClick: () => { if (confirm('Delete this quote?')) remove.mutate(q.id); }, variant: 'danger' },
                ]} />
              </div>
            </Card>
          ))
        )}
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit Quote' : 'New Quote'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button
              disabled={!form.title || form.lines.length === 0}
              loading={save.isPending}
              onClick={() => save.mutate(form)}
            >
              {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Quote'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!editing && quoteTemplates && quoteTemplates.length > 0 && (
            <div className="form-section">
              <p className="form-section-title flex items-center gap-1.5"><LayoutTemplate size={13} /> Start from a template</p>
              <SearchableSelect
                ariaLabel="Template"
                value=""
                onChange={val => {
                  const t = quoteTemplates.find(t => t.id === val);
                  if (t) setForm(f => ({ ...f, lines: t.lines.map(l => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })) }));
                }}
                options={quoteTemplates.map(t => ({ value: t.id, label: t.name }))}
                placeholder="— none, start blank —"
              />
            </div>
          )}
          <div className="form-section">
            <p className="form-section-title">Quote Details</p>
            <FormGrid cols={2}>
              <Field label="Title" required>
                <Input aria-label="Title" placeholder="e.g. Proposal for Acme Corp"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </Field>
              <Field label="Valid Until">
                <Input type="date"
                  value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} />
              </Field>
            </FormGrid>
          </div>

          {/* Line items */}
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
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input inputSize="sm" className="col-span-6"
                    aria-label="Description" placeholder="Service description"
                    value={line.description}
                    onChange={e => updateLine(i, 'description', e.target.value)} />
                  <Input inputSize="sm" type="number" min="1" aria-label="Qty" className="col-span-2 text-center"
                    value={line.quantity}
                    onChange={e => updateLine(i, 'quantity', Number(e.target.value))} />
                  <Input inputSize="sm" type="number" min="0" step="0.01" className="col-span-3"
                    aria-label="Price" placeholder="0.00"
                    value={line.unitPrice}
                    onChange={e => updateLine(i, 'unitPrice', Number(e.target.value))} />
                  <IconButton
                    label="Remove line"
                    tone="danger"
                    className="col-span-1 disabled:!opacity-0"
                    icon={<Trash2 size={14} />}
                    disabled={form.lines.length === 1}
                    onClick={() => removeLine(i)}
                  />
                </div>
              ))}
              <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={addLine} className="mt-1">
                Add line
              </Button>
            </div>
          </div>

          {editing && <>
              <RecordTags entityType="QUOTE" entityId={editing.id} />
              <Attachments entityType="QUOTE" entityId={editing.id} />
              <RecordTasks entityType="QUOTE" entityId={editing.id} />
            </>}

          {/* Total */}
          <div className="flex justify-end pt-2 border-t border-line-subtle">
            <div className="text-right">
              <span className="text-sm text-fg-muted">Total: </span>
              <span className="text-lg font-semibold text-fg tabular-nums">{money(lineTotal)}</span>
            </div>
          </div>
        </div>
      </Modal>
      </PageBody>
    </div>
  );
}
