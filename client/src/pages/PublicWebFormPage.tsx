/**
 * PublicWebFormPage — the hosted, no-login web-to-lead / web-to-ticket form
 * at /form/:id. This is what an org embeds on its own website (directly or
 * via the iframe snippet from Admin → Web Forms). Standalone page: no app
 * shell, no auth — just the branded form and a thank-you state.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Send, AlertCircle } from 'lucide-react';
import { api } from '../api/client';

interface Meta { id: string; type: 'LEAD' | 'TICKET'; title: string; intro: string | null; orgName: string; orgId: string }

export default function PublicWebFormPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', subject: '', message: '', website: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/public/forms/${id}`)
      .then(r => setMeta(r.data))
      .catch(() => setNotFound(true));
  }, [id]);

  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSending(true);
    try {
      const r = await api.post(`/public/forms/${id}/submit`, form);
      setDone(r.data?.message || 'Thanks — received.');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Something went wrong — please try again.');
    } finally {
      setSending(false);
    }
  }

  const input = 'w-full h-10 px-3 rounded-lg border border-line bg-surface text-[14px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent-ring';

  if (notFound) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <p className="text-fg-muted text-sm flex items-center gap-2"><AlertCircle size={16} /> This form is not available.</p>
      </div>
    );
  }
  if (!meta) return <div className="min-h-screen bg-canvas" />;

  return (
    <div className="min-h-screen bg-canvas flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="bg-surface border border-line rounded-2xl shadow-ui-lg overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b border-line-subtle">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">{meta.orgName}</p>
            <h1 className="text-[20px] font-semibold text-fg tracking-tight">{meta.title}</h1>
            {meta.intro && <p className="text-[13.5px] text-fg-muted mt-1.5">{meta.intro}</p>}
          </div>

          {done ? (
            <div className="px-6 py-12 text-center">
              <CheckCircle2 size={36} className="mx-auto text-success mb-3" />
              <p className="text-[15px] font-medium text-fg">{done}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-[12.5px] font-medium text-fg mb-1">Your name <span className="text-danger">*</span></span>
                  <input className={input} required value={form.name} onChange={f('name')} placeholder="Jane Smith" />
                </label>
                <label className="block">
                  <span className="block text-[12.5px] font-medium text-fg mb-1">Email <span className="text-danger">*</span></span>
                  <input className={input} required type="email" value={form.email} onChange={f('email')} placeholder="jane@company.com" />
                </label>
                <label className="block">
                  <span className="block text-[12.5px] font-medium text-fg mb-1">Phone</span>
                  <input className={input} value={form.phone} onChange={f('phone')} placeholder="+1 555 000 0000" />
                </label>
                {meta.type === 'LEAD' ? (
                  <label className="block">
                    <span className="block text-[12.5px] font-medium text-fg mb-1">Company</span>
                    <input className={input} value={form.company} onChange={f('company')} placeholder="Company name" />
                  </label>
                ) : (
                  <label className="block sm:col-span-1">
                    <span className="block text-[12.5px] font-medium text-fg mb-1">Subject <span className="text-danger">*</span></span>
                    <input className={input} required value={form.subject} onChange={f('subject')} placeholder="What's the issue about?" />
                  </label>
                )}
              </div>
              <label className="block">
                <span className="block text-[12.5px] font-medium text-fg mb-1">
                  {meta.type === 'LEAD' ? 'How can we help?' : 'Describe the issue'} {meta.type === 'TICKET' && <span className="text-danger">*</span>}
                </span>
                <textarea
                  className={`${input} h-28 py-2 resize-none`}
                  required={meta.type === 'TICKET'}
                  value={form.message} onChange={f('message')}
                  placeholder={meta.type === 'LEAD' ? 'Tell us what you are looking for…' : 'What happened, and what did you expect?'}
                />
              </label>
              {/* Honeypot — humans never see it, bots fill it. */}
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={f('website')} name="website" className="hidden" aria-hidden="true" />
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <button
                type="submit" disabled={sending}
                className="w-full h-11 rounded-lg bg-accent text-accent-fg text-[14px] font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                <Send size={15} /> {sending ? 'Sending…' : meta.type === 'LEAD' ? 'Send message' : 'Submit request'}
              </button>
            </form>
          )}
        </div>
        <p className="text-center text-[11px] text-fg-subtle mt-4">Powered by {meta.orgName}</p>
      </div>
    </div>
  );
}
