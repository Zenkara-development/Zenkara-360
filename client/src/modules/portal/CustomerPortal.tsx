import { asset } from '../../shared/asset';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Plus, ArrowLeft, Send, LogOut, Ticket, CheckCircle, Clock, AlertCircle, MessageCircle, X } from 'lucide-react';
import {
  Spinner, Button, IconButton, Card, Field, Input, Textarea,
  Badge, Alert, EmptyState, SkeletonCard, ticketStatusVariant,
} from '../../shared/components';
import { formatDate, formatDateTime } from '../../utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalSession {
  token: string;
  user: { id: string; name: string; email: string; orgId: string; orgTimezone?: string };
}

interface PortalTicket {
  id: string;
  title: string;
  body: string;
  status: string;
  priority: string;
  createdAt: string;
  category?: { name: string } | null;
}

// ─── Portal API ───────────────────────────────────────────────────────────────

// Same VITE_API_URL bug as api/client.ts's baseURL — hardcoded to a relative
// path, so on any host without a same-origin /api proxy (Netlify included)
// this hits the frontend's own domain instead of the backend.
const BASE = `${import.meta.env.VITE_API_URL || '/api'}/portal`;

function portalApi(token: string) {
  return axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${token}` } });
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, React.ReactNode> = {
  OPEN: <Clock size={11} />,
  IN_PROGRESS: <AlertCircle size={11} />,
  PENDING: <Clock size={11} />,
  RESOLVED: <CheckCircle size={11} />,
  CLOSED: <CheckCircle size={11} />,
};

/* Colours come from Badge.tsx's shared `ticketStatusVariant` map rather than a
   local one, so the portal cannot drift from the staff-side ticket colours. */
function TicketStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={ticketStatusVariant[status] ?? 'gray'}>
      {STATUS_ICONS[status]} {status.replace('_', ' ')}
    </Badge>
  );
}

/* Shared shell for the unauthenticated screens (login / verify / bad link). */
function PortalSplash({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-slide-up">{children}</div>
    </div>
  );
}

// ─── LOGIN VIEW ───────────────────────────────────────────────────────────────

function LoginView({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      await axios.post(`${BASE}/request-access`, { email, orgId });
      setSent(true);
    } catch (err: any) {
      // Surface the server's actual message (e.g. missing org id) instead of
      // a generic string that masks real failures — this is a public,
      // unauthenticated form so it doesn't go through the main api client's
      // toast interceptor.
      setError(err?.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PortalSplash>
      {/* Logo */}
      <div className="text-center mb-8">
        <img src={asset("logo.svg")} alt="Logo" className="w-14 h-14 mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-fg tracking-tight">Support Portal</h1>
        <p className="text-sm text-fg-muted mt-1">Submit and track your support tickets</p>
      </div>

      {sent ? (
        <Card padding="lg" tone="raised" className="text-center">
          <CheckCircle size={40} className="text-success mx-auto mb-3" />
          <h3 className="font-semibold text-fg mb-2">Check your email</h3>
          <p className="text-sm text-fg-muted leading-relaxed">
            We sent a magic login link to <strong className="text-fg">{email}</strong>. The link expires in 30 minutes.
          </p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </Card>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card padding="lg" tone="raised">
            <Field label="Your email address" htmlFor="portal-email">
              <Input
                id="portal-email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="email"
                placeholder="you@company.com"
                required
              />
            </Field>
            {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
            <Button
              type="submit"
              size="lg"
              block
              className="mt-4"
              disabled={!email}
              loading={loading}
              icon={<Send size={15} />}
            >
              Send magic link
            </Button>
            <p className="text-xs text-fg-subtle text-center mt-4 leading-relaxed">
              No password needed — we'll email you a one-click login link.
            </p>
          </Card>
        </form>
      )}
    </PortalSplash>
  );
}

// ─── VERIFY VIEW ─────────────────────────────────────────────────────────────

function VerifyView({ token, orgId, onLogin }: { token: string; orgId: string; onLogin: (s: PortalSession) => void }) {
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${BASE}/verify?token=${token}&org=${orgId}`)
      .then(r => onLogin(r.data))
      .catch(() => setError('This link is invalid or has expired. Please request a new one.'));
  }, []);

  if (error) return (
    <PortalSplash>
      <Card padding="lg" tone="raised" className="text-center">
        <AlertCircle size={48} className="text-danger mx-auto mb-4" />
        <h2 className="font-semibold text-fg mb-2">Link expired</h2>
        <p className="text-sm text-fg-muted mb-4 leading-relaxed">{error}</p>
        <a href={`/portal?org=${orgId}`} className="text-accent text-sm hover:underline font-medium">
          Request a new link →
        </a>
      </Card>
    </PortalSplash>
  );

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center">
        <Spinner label="Signing you in…" />
      </div>
    </div>
  );
}

// ─── TICKET LIST ──────────────────────────────────────────────────────────────

function TicketListView({ session, onNew, onSelect }: { session: PortalSession; onNew: () => void; onSelect: (t: PortalTicket) => void }) {
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi(session.token).get('/tickets')
      .then(r => setTickets(r.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-fg tracking-tight">My Tickets</h2>
        <Button icon={<Plus size={14} />} onClick={onNew}>New Ticket</Button>
      </div>

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      ) : tickets.length === 0 ? (
        <Card padding="none" flat className="border-dashed">
          <EmptyState
            icon={<Ticket />}
            title="No tickets yet"
            description="When something needs our attention, open a ticket and track its progress right here."
            action={{ label: 'Create your first ticket', onClick: onNew }}
          />
        </Card>
      ) : (
        <div className="space-y-3 animate-fade-in">
          {tickets.map(t => (
            <Card
              key={t.id}
              padding="sm"
              interactive
              role="button"
              tabIndex={0}
              onClick={() => onSelect(t)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t); }
              }}
              className="text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-fg text-sm truncate" title={t.title}>{t.title}</p>
                  <p className="text-xs text-fg-muted mt-0.5 line-clamp-2 leading-relaxed">{t.body}</p>
                </div>
                <div className="shrink-0">
                  <TicketStatusBadge status={t.status} />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                {t.category && <span className="text-xs text-fg-muted">{t.category.name}</span>}
                <span className="text-xs text-fg-subtle">{formatDate(t.createdAt, session.user.orgTimezone)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NEW TICKET ───────────────────────────────────────────────────────────────

function NewTicketView({ session, onBack, onCreated }: { session: PortalSession; onBack: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !body) return;
    setLoading(true);
    setError('');
    try {
      await portalApi(session.token).post('/tickets', { title, body });
      onCreated();
    } catch {
      setError('Failed to submit ticket. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div>
      <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack} className="mb-6 -ml-3">
        Back
      </Button>
      <h2 className="text-lg font-semibold text-fg mb-6 tracking-tight">Submit a Ticket</h2>
      <form onSubmit={handleSubmit}>
        <Card padding="lg" className="space-y-5">
          <Field label="Subject" required htmlFor="portal-ticket-title">
            <Input
              id="portal-ticket-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder="Briefly describe your issue"
            />
          </Field>
          <Field label="Details" required htmlFor="portal-ticket-body">
            <Textarea
              id="portal-ticket-body"
              value={body}
              onChange={e => setBody(e.target.value)}
              required
              rows={6}
              className="resize-none"
              placeholder="Describe your issue in detail. Include any steps to reproduce, error messages, or screenshots."
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" block onClick={onBack}>Cancel</Button>
            <Button
              type="submit"
              block
              disabled={!title || !body}
              loading={loading}
              icon={<Send size={14} />}
            >
              Submit Ticket
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

// ─── TICKET DETAIL ────────────────────────────────────────────────────────────

function TicketDetailView({ ticket, onBack, timezone }: { ticket: PortalTicket; onBack: () => void; timezone?: string }) {
  return (
    <div>
      <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack} className="mb-6 -ml-3">
        Back to tickets
      </Button>
      <Card padding="lg">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-base font-semibold text-fg tracking-tight">{ticket.title}</h2>
          <TicketStatusBadge status={ticket.status} />
        </div>
        {ticket.category && <p className="text-xs text-fg-muted mb-3">Category: {ticket.category.name}</p>}
        <div className="bg-surface-sunken border border-line-subtle rounded-card p-4 text-sm text-fg whitespace-pre-wrap leading-relaxed">
          {ticket.body}
        </div>
        <p className="text-xs text-fg-subtle mt-4">Submitted on {formatDateTime(ticket.createdAt, timezone)}</p>
      </Card>
    </div>
  );
}

// ─── LIVE CHAT WIDGET ─────────────────────────────────────────────────────────
// A small floating widget, deliberately poll-based (every 5s while open)
// rather than holding an SSE/WebSocket connection open — matches this
// module's intentionally simple, non-React-Query architecture (see the
// module-level note in the Technical Docs about the customer portal). Backed
// by the same Conversation/Message tables as staff Email/WhatsApp inboxes —
// see portal.controller.ts getChatMessages/sendChatMessage.

interface ChatMessage { id: string; direction: 'INBOUND' | 'OUTBOUND'; body: string; sentAt: string }

function PortalChatWidget({ session }: { session: PortalSession }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function fetchMessages() {
    try {
      const { data } = await portalApi(session.token).get('/chat');
      setMessages(data.messages);
    } catch { /* best-effort */ }
  }

  useEffect(() => {
    if (!open) return;
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    const body = draft;
    setDraft('');
    try {
      await portalApi(session.token).post('/chat', { body });
      fetchMessages();
    } finally { setSending(false); }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-4 left-4 sm:left-auto sm:right-6 sm:w-80 h-96 bg-surface-raised rounded-card shadow-ui-lg border border-line flex flex-col z-50 overflow-hidden animate-scale-in">
          <div className="flex items-center justify-between px-4 py-3 bg-accent text-accent-fg shrink-0">
            <p className="text-sm font-semibold">Live chat</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close live chat"
              title="Close live chat"
              className="p-1 rounded-btn hover:bg-accent-fg/15 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-xs text-fg-muted text-center mt-6">Send a message and our team will reply here.</p>
            )}
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.direction === 'INBOUND' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm leading-relaxed ${
                  m.direction === 'INBOUND'
                    ? 'bg-accent text-accent-fg rounded-br-sm'
                    : 'bg-surface-sunken text-fg border border-line-subtle rounded-bl-sm'
                }`}>
                  {m.body}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={handleSend} className="flex items-center gap-2 p-2.5 border-t border-line-subtle shrink-0">
            <Input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              aria-label="Message"
              placeholder="Type a message…"
              className="flex-1 min-w-0"
            />
            <Button
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim()}
              loading={sending}
              icon={<Send size={14} />}
              className="shrink-0 !px-3"
            />
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-5 right-5 w-14 h-14 rounded-full bg-accent text-accent-fg shadow-ui-lg flex items-center justify-center hover:bg-accent-hover active:bg-accent-active transition-colors z-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        aria-label="Open live chat"
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </>
  );
}

// ─── MAIN PORTAL ─────────────────────────────────────────────────────────────

export function CustomerPortal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const rawOrgId = searchParams.get('org') || '';
  const verifyToken = searchParams.get('token');
  const isVerify = !!verifyToken && window.location.pathname.includes('/portal/verify');

  const [session, setSession] = useState<PortalSession | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('portalSession') || 'null'); } catch { return null; }
  });
  const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
  const [selectedTicket, setSelectedTicket] = useState<PortalTicket | null>(null);

  const orgId = session?.user.orgId || rawOrgId;

  function login(s: PortalSession) {
    sessionStorage.setItem('portalSession', JSON.stringify(s));
    setSession(s);
    navigate(`/portal?org=${s.user.orgId}`, { replace: true });
  }

  function logout() {
    sessionStorage.removeItem('portalSession');
    setSession(null);
    setView('list');
  }

  if (isVerify && !session) {
    return <VerifyView token={verifyToken!} orgId={rawOrgId} onLogin={login} />;
  }

  if (!session) {
    // No point rendering the login form at all if we already know it can't
    // work — a bare/bookmarked /portal URL with no ?org=... query param
    // (every real invite/portal link always includes one) would otherwise
    // let someone submit their email and see the normal "check your email"
    // success screen despite nothing ever being sent.
    if (!orgId) {
      return (
        <PortalSplash>
          <Card padding="lg" tone="raised" className="text-center">
            <AlertCircle size={40} className="text-warning mx-auto mb-3" />
            <h3 className="font-semibold text-fg mb-2">Missing organization</h3>
            <p className="text-sm text-fg-muted leading-relaxed">This link is missing your organization. Please use the exact link from your invite email, or ask your support team to resend it.</p>
          </Card>
        </PortalSplash>
      );
    }
    return <LoginView orgId={orgId} />;
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="bg-surface/90 backdrop-blur-sm border-b border-line sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={asset("logo.svg")} alt="Logo" className="w-7 h-7" />
            <span className="font-semibold text-fg text-sm">Support Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted hidden sm:block">{session.user.email}</span>
            <IconButton label="Sign out" tone="danger" icon={<LogOut size={15} />} onClick={logout} />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Welcome banner */}
        {view === 'list' && (
          <div className="bg-accent text-accent-fg rounded-card shadow-ui-sm p-5 mb-6 animate-fade-in">
            <p className="text-sm font-medium opacity-80">Welcome back</p>
            <p className="text-xl font-semibold tracking-tight truncate" title={session.user.name}>{session.user.name}</p>
          </div>
        )}

        {view === 'list' && (
          <TicketListView
            session={session}
            onNew={() => setView('new')}
            onSelect={t => { setSelectedTicket(t); setView('detail'); }}
          />
        )}
        {view === 'new' && (
          <NewTicketView session={session} onBack={() => setView('list')} onCreated={() => setView('list')} />
        )}
        {view === 'detail' && selectedTicket && (
          <TicketDetailView ticket={selectedTicket} onBack={() => setView('list')} timezone={session.user.orgTimezone} />
        )}
      </main>

      <PortalChatWidget session={session} />
    </div>
  );
}
