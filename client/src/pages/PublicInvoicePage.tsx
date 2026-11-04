import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Receipt, Printer } from 'lucide-react';
import { api } from '../api/client';
import { formatCurrency, formatDate } from '../utils/format';
import {
  Card, Table, Th, Td, Button, Badge, Spinner, EmptyState, invoiceStatusVariant,
} from '../shared/components';

interface InvoiceLine { id: string; description: string; quantity: string; unitPrice: string; discount: string }
interface Invoice {
  id: string; invoiceNumber: string; title: string; status: string;
  dueDate?: string; paidAt?: string; taxRate: string; createdAt: string;
  lines: InvoiceLine[]; org: { name: string; currency?: string; timezone?: string }; deal?: { title: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SENT: 'Payment Due', PAID: 'Paid', OVERDUE: 'Overdue', VOID: 'Void',
};

function lineTotal(l: InvoiceLine) {
  const qty = Number(l.quantity), price = Number(l.unitPrice), disc = Number(l.discount) || 0;
  return qty * price * (1 - disc / 100);
}

// Public, token-secured — no auth. Print-to-PDF via the browser's native
// print dialog rather than pulling in a server-side PDF library; the layout
// below is print-tuned (see the @media print rules) so "Save as PDF" from
// the browser produces a clean one-pager. index.css's @media print block
// pins the tokens to the light palette, so the normal tokens are safe here.
export function PublicInvoicePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') || '';

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id || !token) { setError('This link is invalid.'); setLoading(false); return; }
    api.get(`/invoices/public/${id}`, { params: { t: token } })
      .then(res => setInvoice(res.data))
      .catch(() => setError('This invoice could not be found, or the link has expired.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner label={null} /></div>;
  }
  if (error && !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <EmptyState icon={<Receipt />} title={error} />
      </div>
    );
  }
  if (!invoice) return null;

  const subtotal = invoice.lines.reduce((s, l) => s + lineTotal(l), 0);
  const taxRate = Number(invoice.taxRate) || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;
  const money = (v: number) => formatCurrency(v, invoice.org.currency || 'USD');
  const date = (v?: string) => formatDate(v, invoice.org.timezone || 'UTC');

  return (
    <div className="min-h-screen bg-canvas py-8 px-4 sm:py-14 print:py-0 print:px-0">
      <div className="max-w-2xl mx-auto animate-fade-in">
        <div className="flex justify-end mb-3 print:hidden">
          <Button icon={<Printer size={14} />} onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>

        <Card padding="none" className="overflow-hidden print:shadow-none print:border-0 print:rounded-none">
          <div className="px-5 py-5 sm:px-8 sm:py-6 border-b border-line-subtle flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-fg-subtle">{invoice.org.name}</p>
              <h1 className="text-lg sm:text-xl font-semibold text-fg tracking-tight mt-1 flex items-center gap-2">
                <Receipt size={18} className="text-accent shrink-0" /> {invoice.title}
              </h1>
              <p className="text-xs text-fg-subtle mt-1 font-mono tabular-nums">{invoice.invoiceNumber}</p>
              {invoice.deal?.title && <p className="text-xs text-fg-subtle mt-0.5">Re: {invoice.deal.title}</p>}
            </div>
            <Badge variant={invoiceStatusVariant[invoice.status] ?? 'gray'}>
              {STATUS_LABEL[invoice.status] ?? invoice.status}
            </Badge>
          </div>

          <div className="px-5 py-3 sm:px-8 grid grid-cols-2 gap-3 text-xs border-b border-line-subtle">
            <p className="text-fg-subtle">Issued <span className="text-fg font-medium ml-1">{date(invoice.createdAt)}</span></p>
            {invoice.dueDate && <p className="text-fg-subtle">Due <span className="text-fg font-medium ml-1">{date(invoice.dueDate)}</span></p>}
            {invoice.paidAt && <p className="text-success col-span-2 font-medium">Paid on {date(invoice.paidAt)}</p>}
          </div>

          <div className="px-5 py-5 sm:px-8 sm:py-6">
            <Table minWidth={480}>
              <thead>
                <tr>
                  <Th>Description</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map(l => (
                  <tr key={l.id}>
                    <Td>{l.description}</Td>
                    <Td align="right" muted className="tabular-nums">{l.quantity}</Td>
                    <Td align="right" muted className="tabular-nums">{money(Number(l.unitPrice))}</Td>
                    <Td align="right" className="font-medium tabular-nums">{money(lineTotal(l))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex justify-end mt-4 pt-4 border-t border-line-subtle">
              <div className="text-right space-y-0.5 tabular-nums">
                <p className="text-xs text-fg-subtle">Subtotal <span className="text-fg font-medium ml-2">{money(subtotal)}</span></p>
                {taxRate > 0 && <p className="text-xs text-fg-subtle">Tax ({taxRate}%) <span className="text-fg font-medium ml-2">{money(taxAmount)}</span></p>}
                <p className="text-xl font-semibold text-fg mt-1 tracking-tight">{money(total)}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <style>{`
        @media print {
          @page { margin: 1.5cm; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}
