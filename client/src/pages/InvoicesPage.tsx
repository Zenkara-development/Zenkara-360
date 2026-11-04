import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  RowActions, EmptyState, StatusBadge, PageHeader, PageBody, Button, IconButton, Modal, Card,
  Field, Input, Textarea, FormGrid, SkeletonCard, invoiceStatusVariant, AccessDenied,
} from '../shared/components';
import { Receipt, Plus, Pencil, Trash2, Link2, Check as CheckIcon, Send, Sparkles, Copy } from 'lucide-react';
import { useInvoiceReminder } from '../api/ai';
import { AiGeneratedTag } from '../shared/components';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

interface InvoiceLine { id?: string; description: string; quantity: number; unitPrice: number; discount: number }
interface Invoice {
  // See QuotesPage: absent from the type, so edit blanked it every save.
  notes?: string | null;
  id: string; invoiceNumber: string; title: string; status: string;
  dueDate: string | null; paidAt: string | null; taxRate: number; createdAt: string;
  deal?: { title: string } | null; quote?: { title: string } | null; lines: InvoiceLine[];
}

const EMPTY_LINE: InvoiceLine = { description: '', quantity: 1, unitPrice: 0, discount: 0 };

function lineTotal(l: InvoiceLine) {
  return Number(l.quantity) * Number(l.unitPrice) * (1 - (Number(l.discount) || 0) / 100);
}

export default function InvoicesPage() {
  const qc = useQueryClient();
  const { money, date } = useFormat();
  /* AI payment-reminder draft — which invoice it was generated for, plus the
     result, so the draft renders inline under that invoice's card. */
  const aiReminder = useInvoiceReminder();
  const [reminderFor, setReminderFor] = useState<string | null>(null);
  const [reminderCopied, setReminderCopied] = useState(false);
  const { user } = useAuth();
  /* /invoices is CRM_STAFF-only on the server. */
  const canReadInvoices = can.readQuotesInvoices(user?.role);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [form, setForm] = useState({ title: '', dueDate: '', notes: '', taxRate: 0, lines: [{ ...EMPTY_LINE }] });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn: () => api.get('/invoices').then(r => r.data.data ?? r.data),
    enabled: canReadInvoices,
  });

  const save = useMutation({
    mutationFn: (body: typeof form) =>
      editing
        ? api.patch(`/invoices/${editing.id}`, body).then(r => r.data)
        : api.post('/invoices', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); closeModal(); },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/invoices/${id}/status`, { status }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });

  // After every hook.
  if (!canReadInvoices) return <AccessDenied />;

  async function copyShareLink(id: string) {
    try {
      const { data } = await api.get(`/invoices/${id}/share-link`);
      await navigator.clipboard.writeText(data.link);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { alert('Could not generate share link.'); }
  }

  function openCreate() {
    setEditing(null);
    setForm({ title: '', dueDate: '', notes: '', taxRate: 0, lines: [{ ...EMPTY_LINE }] });
    setShowModal(true);
  }

  function openEdit(inv: Invoice) {
    setEditing(inv);
    setForm({
      title: inv.title,
      dueDate: inv.dueDate ? inv.dueDate.split('T')[0] : '',
      notes: inv.notes ?? '',
      taxRate: Number(inv.taxRate) || 0,
      lines: inv.lines.map(l => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discount: Number(l.discount) || 0 })),
    });
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function updateLine(i: number, field: keyof InvoiceLine, value: string | number) {
    setForm(f => {
      const lines = [...f.lines];
      lines[i] = { ...lines[i], [field]: value };
      return { ...f, lines };
    });
  }
  function addLine() { setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] })); }
  function removeLine(i: number) { setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) })); }

  const subtotal = form.lines.reduce((s, l) => s + lineTotal(l), 0);
  const taxAmount = subtotal * (Number(form.taxRate) / 100);
  const grandTotal = subtotal + taxAmount;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Invoices"
        subtitle="Generate, send and track payment status"
        actions={<Button icon={<Plus size={16} />} onClick={openCreate}>New Invoice</Button>}
      />

      <PageBody width="full" className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <>
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
          </>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<Receipt size={22} />}
            title="No invoices yet"
            description="Create your first invoice, or accept a quote and one is generated for you automatically."
            action={{ label: 'New Invoice', onClick: openCreate }}
          />
        ) : (
          invoices.map(inv => {
            const total = inv.lines.reduce((s, l) => s + lineTotal(l), 0) * (1 + (Number(inv.taxRate) || 0) / 100);
            return (
              <Card key={inv.id} className="hover:shadow-ui-md transition-shadow">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-mono text-fg-subtle tabular-nums">{inv.invoiceNumber}</span>
                      <h3 className="font-semibold text-fg truncate" title={inv.title}>{inv.title}</h3>
                      <StatusBadge value={inv.status} map={invoiceStatusVariant} dot />
                    </div>
                    {inv.deal?.title && <p className="text-xs text-fg-muted truncate" title={inv.deal.title}>Deal: {inv.deal.title}</p>}
                    {inv.quote?.title && <p className="text-xs text-fg-subtle truncate" title={inv.quote.title}>From quote: {inv.quote.title}</p>}
                    <p className="text-xs text-fg-subtle mt-0.5">{date(inv.createdAt)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center justify-end gap-1 text-xl font-semibold text-fg tabular-nums tracking-tight">
                      {money(total)}
                    </div>
                    {inv.dueDate && <p className="text-xs text-fg-subtle">Due {date(inv.dueDate)}</p>}
                    {inv.paidAt && <p className="text-xs text-success">Paid {date(inv.paidAt)}</p>}
                  </div>
                </div>

                {inv.lines?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-line-subtle">
                    <div className="space-y-1">
                      {inv.lines.slice(0, 3).map((l, i) => (
                        <div key={i} className="flex justify-between gap-3 text-xs text-fg-muted">
                          <span className="truncate" title={l.description}>{l.description} × {Number(l.quantity)}</span>
                          <span className="tabular-nums shrink-0">{money(lineTotal(l))}</span>
                        </div>
                      ))}
                      {inv.lines.length > 3 && <p className="text-xs text-fg-subtle">+{inv.lines.length - 3} more items</p>}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  {inv.status === 'DRAFT' && (
                    <Button size="xs" variant="subtle" icon={<Send size={12} />}
                      onClick={() => changeStatus.mutate({ id: inv.id, status: 'SENT' })}>
                      Send
                    </Button>
                  )}
                  {(inv.status === 'SENT' || inv.status === 'OVERDUE') && (
                    <Button size="xs" variant="subtle" icon={<CheckIcon size={12} />}
                      onClick={() => changeStatus.mutate({ id: inv.id, status: 'PAID' })}>
                      Mark Paid
                    </Button>
                  )}
                  {inv.status !== 'DRAFT' && (
                    <Button size="xs" variant="secondary"
                      icon={copiedId === inv.id ? <CheckIcon size={12} /> : <Link2 size={12} />}
                      onClick={() => copyShareLink(inv.id)}>
                      {copiedId === inv.id ? 'Copied' : 'Copy customer link'}
                    </Button>
                  )}
                  {(inv.status === 'SENT' || inv.status === 'OVERDUE') && (
                    <Button size="xs" variant="secondary" icon={<Sparkles size={12} />}
                      loading={aiReminder.isPending && reminderFor === inv.id}
                      onClick={() => { setReminderFor(inv.id); setReminderCopied(false); aiReminder.mutate(inv.id); }}>
                      Draft reminder
                    </Button>
                  )}
                  <RowActions items={[
                    { label: 'Edit invoice', icon: <Pencil size={14} />, onClick: () => openEdit(inv), hidden: inv.status === 'PAID' || inv.status === 'VOID' },
                    { label: 'Void invoice', icon: <Trash2 size={14} />, onClick: () => changeStatus.mutate({ id: inv.id, status: 'VOID' }), hidden: inv.status === 'PAID' || inv.status === 'VOID' },
                    { label: 'Delete invoice', icon: <Trash2 size={14} />, onClick: () => { if (confirm('Delete this invoice?')) remove.mutate(inv.id); }, variant: 'danger' },
                  ]} />
                </div>

                {/* AI payment-reminder draft — tone matches how overdue the
                    invoice is (friendly nudge vs. firm final notice). */}
                {reminderFor === inv.id && aiReminder.data && (
                  <div className="mt-3 rounded-card border border-line overflow-hidden shadow-ui-sm">
                    <div className="flex items-center gap-2 px-3.5 py-2.5 bg-surface-sunken border-b border-line-subtle">
                      <Send size={13} className="text-accent shrink-0" />
                      <p className="text-[13px] font-semibold text-fg truncate">{aiReminder.data.subject}</p>
                      <span className="ml-auto shrink-0"><AiGeneratedTag /></span>
                    </div>
                    <div className="px-3.5 py-3 bg-surface">
                      <pre className="text-[12.5px] whitespace-pre-wrap font-sans leading-relaxed text-fg-muted">{aiReminder.data.body}</pre>
                    </div>
                    <div className="flex items-center gap-2 px-3.5 py-2 border-t border-line-subtle bg-surface-sunken">
                      <p className="text-[11.5px] text-fg-subtle">Review, then paste into your email client.</p>
                      <IconButton className="ml-auto" label="Copy reminder"
                        icon={reminderCopied ? <CheckIcon size={13} className="text-success" /> : <Copy size={13} />}
                        onClick={() => {
                          navigator.clipboard.writeText(`Subject: ${aiReminder.data!.subject}\n\n${aiReminder.data!.body}`);
                          setReminderCopied(true);
                          setTimeout(() => setReminderCopied(false), 1600);
                        }} />
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit Invoice' : 'New Invoice'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button
              disabled={!form.title || form.lines.length === 0}
              loading={save.isPending}
              onClick={() => save.mutate(form)}
            >
              {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Invoice'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="form-section">
            <p className="form-section-title">Invoice Details</p>
            <FormGrid cols={2}>
              <Field label="Title" required>
                <Input aria-label="Title" placeholder="e.g. Services for Acme Corp"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </Field>
              <Field label="Due Date">
                <Input type="date"
                  value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </Field>
            </FormGrid>
            <Field label="Tax rate (%)" className="mt-3">
              <Input type="number" min={0} max={100} step="0.01" className="w-32"
                value={form.taxRate} onChange={e => setForm(f => ({ ...f, taxRate: Number(e.target.value) }))} />
            </Field>
            <Field label="Notes (optional)" className="mt-3">
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>

          <div className="form-section">
            <p className="form-section-title">Line Items</p>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-fg-muted uppercase px-1">
                <div className="col-span-5">Description</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Price</div>
                <div className="col-span-2">Disc %</div>
                <div className="col-span-1"></div>
              </div>
              {form.lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input inputSize="sm" className="col-span-5"
                    aria-label="Description" placeholder="Item description"
                    value={line.description}
                    onChange={e => updateLine(i, 'description', e.target.value)} />
                  <Input inputSize="sm" type="number" min="1" aria-label="Qty" className="col-span-2 text-center"
                    value={line.quantity}
                    onChange={e => updateLine(i, 'quantity', Number(e.target.value))} />
                  <Input inputSize="sm" type="number" min="0" step="0.01" className="col-span-2"
                    aria-label="Price" placeholder="0.00"
                    value={line.unitPrice}
                    onChange={e => updateLine(i, 'unitPrice', Number(e.target.value))} />
                  <Input inputSize="sm" type="number" min="0" max="100" className="col-span-2"
                    aria-label="Discount" placeholder="0"
                    value={line.discount}
                    onChange={e => updateLine(i, 'discount', Number(e.target.value))} />
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

          <div className="flex justify-end pt-4 mt-3 border-t border-line-subtle">
            <div className="text-right text-sm space-y-0.5 tabular-nums">
              <p className="text-fg-muted">Subtotal: <span className="text-fg font-medium">{money(subtotal)}</span></p>
              {Number(form.taxRate) > 0 && <p className="text-fg-muted">Tax ({form.taxRate}%): <span className="text-fg font-medium">{money(taxAmount)}</span></p>}
              <p className="text-lg font-semibold text-fg">{money(grandTotal)}</p>
            </div>
          </div>
        </div>
      </Modal>
      </PageBody>
    </div>
  );
}
