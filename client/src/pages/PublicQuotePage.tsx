import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FileText, CheckCircle2, ShieldCheck, Eraser } from 'lucide-react';
import { api } from '../api/client';
import { formatCurrency, formatDateTime } from '../utils/format';
import {
  Card, Table, Th, Td, Field, Input, Checkbox, Button, Alert, Spinner, EmptyState,
} from '../shared/components';

interface QuoteLine { id: string; description: string; quantity: string; unitPrice: string; discount: string }
interface Quote {
  id: string; title: string; status: string; notes?: string; validUntil?: string;
  lines: QuoteLine[]; org: { name: string; currency?: string; timezone?: string }; deal?: { title: string } | null;
  signerName?: string; signedAt?: string;
}

/** Ink colour for the signature pad. Not a token: this is ink drawn onto a
 *  white signature card that is exported as a PNG and reproduced on printed
 *  and emailed documents, so it has to stay dark in every theme. */
const SIGNATURE_INK = '#1f2937';

function lineTotal(l: QuoteLine) {
  const qty = Number(l.quantity), price = Number(l.unitPrice), disc = Number(l.discount) || 0;
  return qty * price * (1 - disc / 100);
}

/** Hand-drawn signature pad on a <canvas>. The parent owns `canvasRef` and
 *  reads it directly via `canvas.toDataURL()` on submit — the drawing itself
 *  never needs to trigger a re-render, only whether it's empty does. */
function SignaturePad({ canvasRef, onChange }: { canvasRef: React.RefObject<HTMLCanvasElement>; onChange: (hasSignature: boolean) => void }) {
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    lastPointRef.current = point(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    const last = lastPointRef.current;
    if (last) {
      ctx.strokeStyle = SIGNATURE_INK;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    lastPointRef.current = p;
    if (!hasDrawnRef.current) { hasDrawnRef.current = true; onChange(true); }
  }

  function end() { drawingRef.current = false; lastPointRef.current = null; }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    onChange(false);
  }

  return (
    <div>
      {/* Deliberately white in every theme — the pad is the paper the dark ink
          above is drawn on, and it is exported verbatim as a PNG. */}
      <div className="border border-line rounded-input bg-white overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          width={500}
          height={150}
          className="w-full h-[150px] touch-none cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <Button variant="ghost" size="xs" className="mt-1.5" icon={<Eraser size={12} />} onClick={clear}>
        Clear signature
      </Button>
    </div>
  );
}

// Public, token-secured — no auth. Customers land here from a link a sales
// rep copies off the Quote detail page ("Copy customer link"). See
// quotes.controller.ts publicView/publicAccept. index.css's @media print
// block pins the tokens to the light palette, so the normal tokens are safe.
export function PublicQuotePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') || '';

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!id || !token) { setError('This link is invalid.'); setLoading(false); return; }
    api.get(`/quotes/public/${id}`, { params: { t: token } })
      .then(res => setQuote(res.data))
      .catch(() => setError('This quote could not be found, or the link has expired.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    setSubmitting(true); setError('');
    try {
      const signatureImage = hasSignature ? signatureCanvasRef.current?.toDataURL('image/png') : undefined;
      const res = await api.post(`/quotes/public/${id}/accept`, { token, signerName, signerEmail, agreed: true, signatureImage });
      setQuote(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.response?.data?.message || 'Could not submit your acceptance. Please try again.');
    } finally { setSubmitting(false); }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner label={null} /></div>;
  }
  if (error && !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <EmptyState icon={<FileText />} title={error} />
      </div>
    );
  }
  if (!quote) return null;

  const total = quote.lines.reduce((s, l) => s + lineTotal(l), 0);
  const money = (v: number) => formatCurrency(v, quote.org.currency || 'USD');

  return (
    <div className="min-h-screen bg-canvas py-8 px-4 sm:py-14">
      <div className="max-w-2xl mx-auto animate-fade-in">
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-5 sm:px-8 sm:py-6 border-b border-line-subtle">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-fg-subtle">{quote.org.name}</p>
            <h1 className="text-lg sm:text-xl font-semibold text-fg tracking-tight mt-1 flex items-center gap-2">
              <FileText size={18} className="text-accent shrink-0" /> {quote.title}
            </h1>
            {quote.deal?.title && <p className="text-xs text-fg-subtle mt-1">Re: {quote.deal.title}</p>}
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
                {quote.lines.map(l => (
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
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Total</p>
                <p className="text-xl font-semibold text-fg tabular-nums tracking-tight">{money(total)}</p>
              </div>
            </div>
            {quote.notes && <p className="text-sm text-fg-muted mt-4 whitespace-pre-wrap">{quote.notes}</p>}
          </div>

          <div className="px-5 py-5 sm:px-8 sm:py-6 bg-surface-sunken border-t border-line-subtle">
            {quote.status === 'ACCEPTED' ? (
              <Alert
                tone="success"
                icon={<CheckCircle2 size={20} />}
                title={`Accepted${quote.signerName ? ` by ${quote.signerName}` : ''}`}
              >
                {quote.signedAt && formatDateTime(quote.signedAt, quote.org.timezone || 'UTC')}
              </Alert>
            ) : quote.status === 'REJECTED' ? (
              <p className="text-sm text-fg-muted">This quote is no longer available for acceptance.</p>
            ) : (
              <form onSubmit={handleAccept} className="space-y-3">
                <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck size={13} /> Accept this quote
                </p>
                {error && <Alert tone="danger">{error}</Alert>}
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input
                    required value={signerName} onChange={e => setSignerName(e.target.value)}
                    aria-label="Your full name" placeholder="Your full name"
                  />
                  <Input
                    required type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)}
                    aria-label="Your email" placeholder="you@company.com"
                  />
                </div>
                <Field label="Draw your signature">
                  <SignaturePad canvasRef={signatureCanvasRef} onChange={setHasSignature} />
                </Field>
                <Checkbox
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  label="Signing above and checking this box constitutes my electronic signature and acceptance of this quote."
                />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full sm:w-auto"
                  disabled={!agreed}
                  loading={submitting}
                >
                  {submitting ? 'Submitting…' : 'Accept & Sign'}
                </Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
