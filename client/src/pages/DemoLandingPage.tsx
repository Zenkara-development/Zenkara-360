import { asset } from '../shared/asset';
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { Button } from '../shared/components';
import {
  Users, Ticket, Bot, Sparkles, Loader2, ArrowRight,
  TrendingUp, AlertTriangle, CheckCircle2, Clock, Wallet,
  UserSquare2, CheckSquare, ShieldCheck, Zap, Lock, Globe,
} from 'lucide-react';

/*
 * This page is deliberately outside the theme system. It is a dark marketing
 * surface with its own glass-on-slate palette, shown to logged-out visitors
 * before any theme preference exists — so it does not use the --ui-* surface
 * tokens and is excluded from the token codemod. Brand accents still come from
 * `brand-*`, which is bound to the active accent ramp, so the CTA matches
 * whatever theme the product is configured with.
 */

interface DemoPreview {
  stats: { openTickets: number; pipelineValue: number; winRate: number; employees: number };
  deals: { title: string; value: number; stage: string }[];
  tickets: { title: string; priority: string }[];
}

interface DemoVertical {
  slug: string;
  orgName: string;
  industry: string;
  primaryColor: string;
  currency?: string;
  available?: boolean;
  preview?: DemoPreview;
}

const HIGHLIGHTS = [
  { icon: Users,       label: 'Full CRM',         desc: 'Contacts, leads, deals and a live sales pipeline' },
  { icon: Ticket,      label: 'IT Help Desk',     desc: 'Tickets, SLAs, assets and change management' },
  { icon: UserSquare2, label: 'HR & People',      desc: 'Employees, org chart, attendance, leave and payroll' },
  { icon: CheckSquare, label: 'Work & Approvals', desc: 'One task queue across every module, with real approval routing' },
  { icon: Bot,         label: 'AI built in',      desc: 'Lead scoring, ticket triage, and answers cited from your own docs' },
  { icon: ShieldCheck, label: 'Real permissions', desc: 'Control who sees whose records — down to individual fields' },
];

/** Short, factual claims for the strip under the hero. */
const TRUST_POINTS = [
  { icon: Zap,   text: 'No signup, no card' },
  { icon: Lock,  text: 'Isolated demo data' },
  { icon: Globe, text: 'Resets every night' },
];

/** Money for the preview tiles. Compact, because a demo tile is not a ledger. */
function compactMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

/** Rendered until the vertical list loads, and by older backends that don't send `preview`. */
const FALLBACK_PREVIEW: DemoPreview = {
  stats: { openTickets: 4, pipelineValue: 218_000, winRate: 50, employees: 6 },
  deals: [
    { title: 'Globex Platform Licence', value: 120_000, stage: 'Closed Won' },
    { title: 'Acme ERP Implementation', value: 85_000, stage: 'Negotiation' },
    { title: 'Initech Analytics Suite', value: 67_000, stage: 'Prospecting' },
  ],
  tickets: [
    { title: 'Cannot connect to company VPN', priority: 'CRITICAL' },
    { title: 'Laptop not turning on after update', priority: 'HIGH' },
    { title: 'Need access to Salesforce sandbox', priority: 'MEDIUM' },
  ],
};

const PRIORITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-500/15 text-red-300 border-red-500/25',
  HIGH: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  MEDIUM: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  LOW: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
};

/** Glass panel used throughout the page — one definition rather than nine. */
const PANEL = 'bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-sm';

export function DemoLandingPage() {
  const { demoLogin, user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vertical, setVertical] = useState<string>('');

  const { data: verticals } = useQuery<DemoVertical[]>({
    queryKey: ['demo-verticals'],
    queryFn: () => api.get('/demo/verticals').then(r => r.data),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (vertical || !verticals?.length) return;
    // Default to something that can actually be entered, rather than whatever
    // happens to be first in the list.
    setVertical((verticals.find(v => v.available !== false) ?? verticals[0]).slug);
  }, [verticals, vertical]);

  const selected = verticals?.find(v => v.slug === vertical);
  const nothingSeeded = !!verticals?.length && verticals.every(v => v.available === false);

  // The preview panel is driven by the selected vertical's real seed data, so
  // picking "Real Estate" shows rupee-priced property deals rather than the
  // dollar SaaS deals that used to be hardcoded here regardless of choice.
  //
  // FALLBACK_PREVIEW matters more than it looks: a backend running a version
  // older than this field still returns verticals without `preview`, and the
  // panel must render something sensible rather than crash the landing page.
  const currency = selected?.currency ?? 'USD';
  const preview = selected?.preview ?? FALLBACK_PREVIEW;

  const missing = (verticals ?? []).filter(v => v.available === false);
  // An admin looking at a greyed-out industry should be able to fix it from
  // right here. Creating missing workspaces is non-destructive, and hosts
  // without shell access (Render's free tier, for one) have no other route.
  const canSeed = user?.role === 'SUPER_ADMIN' || user?.role === 'PLATFORM_ADMIN';

  const seedMissing = useMutation({
    mutationFn: () =>
      api.post('/demo/seed-missing').then(r => r.data as { created: string[]; message: string }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['demo-verticals'] }),
  });

  async function handleTryDemo() {
    setLoading(true);
    setError('');
    try {
      await demoLogin(vertical);
      navigate('/dashboard');
    } catch (err: any) {
      // The server knows exactly why this failed — a missing demo org needs a
      // seed run, not patience. Swallowing that behind "warming up" sent people
      // away to wait for something that was never going to fix itself.
      setError(
        err?.response?.data?.error ||
          'Could not start the demo. Check the server is running, then try again.'
      );
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white relative overflow-hidden font-sans">
      {/* Ambient light. Sits behind everything and never intercepts a click. */}
      <div className="absolute -top-48 -left-40 w-[34rem] h-[34rem] rounded-full bg-brand-600/20 blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 -right-48 w-[30rem] h-[30rem] rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        }}
      />

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="relative z-10 max-w-7xl mx-auto px-6 lg:px-10 pt-7 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src={asset("logo.svg")} alt="" className="w-8 h-8" />
          <span className="font-semibold tracking-tight">CRMITdesk Evolved</span>
        </div>
        <nav className="flex items-center gap-1.5">
          <Link
            to="/login"
            className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 lg:px-10 py-14 lg:py-20 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-12 lg:gap-16 items-center">
        {/* ── Left: pitch + CTA ──────────────────────────────────────── */}
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 text-brand-300 text-[11px] font-semibold tracking-wider uppercase bg-brand-500/10 border border-brand-500/25 rounded-full px-3 py-1 mb-6">
            <Sparkles size={12} /> Live product demo
          </span>

          <h1 className="text-[2.5rem] sm:text-5xl xl:text-[3.4rem] font-bold leading-[1.05] tracking-tight mb-6 text-balance">
            Your CRM, IT Desk and HR
            <br />
            <span className="bg-gradient-to-r from-brand-200 via-brand-300 to-brand-400 bg-clip-text text-transparent">
              in one workspace
            </span>
          </h1>

          <p className="text-slate-400 text-[15px] leading-relaxed max-w-lg mb-8">
            One click drops you into a fully populated workspace &mdash; customers, deals, support
            tickets, employees, approvals and dashboards, already wired together. Explore it the way
            your team actually would. Nothing to set up.
          </p>

          {verticals && verticals.length > 0 && (
            <div className="mb-7">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-2.5">
                See it set up for your industry
              </p>
              <div className="flex flex-wrap gap-2">
                {verticals.map(v => {
                  const unavailable = v.available === false;
                  return (
                    <button
                      key={v.slug}
                      type="button"
                      onClick={() => setVertical(v.slug)}
                      disabled={unavailable}
                      aria-pressed={vertical === v.slug}
                      title={unavailable ? 'This industry demo has not been seeded on this server yet' : undefined}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                        unavailable
                          ? 'bg-white/[0.02] border-white/5 text-slate-600 cursor-not-allowed line-through'
                          : vertical === v.slug
                            ? 'bg-brand-600 border-brand-500 text-white shadow-lg shadow-brand-600/25'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/25 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {v.industry}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!!missing.length && canSeed && (
            <div className="mb-5 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sky-100 text-sm font-medium">
                  {missing.length} industry workspace{missing.length === 1 ? '' : 's'} not set up yet
                </p>
                <p className="text-sky-200/70 text-xs mt-0.5 leading-relaxed">
                  {missing.map(m => m.orgName).join(', ')} — creating {missing.length === 1 ? 'it' : 'them'} leaves the
                  existing workspaces untouched.
                </p>
                {seedMissing.isError && (
                  <p className="text-red-300 text-xs mt-1">
                    {(seedMissing.error as any)?.response?.data?.error || 'Could not create them.'}
                  </p>
                )}
                {seedMissing.isSuccess && (
                  <p className="text-emerald-300 text-xs mt-1">{seedMissing.data.message}</p>
                )}
              </div>
              <button
                onClick={() => seedMissing.mutate()}
                disabled={seedMissing.isPending}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-100 text-xs font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                {seedMissing.isPending ? (
                  <><Loader2 size={13} className="animate-spin" /> Creating&hellip;</>
                ) : (
                  <>Create missing workspace{missing.length === 1 ? '' : 's'}</>
                )}
              </button>
            </div>
          )}

          {nothingSeeded && (
            <div className="mb-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3.5">
              <p className="text-amber-200 text-sm font-medium">No demo workspaces have been set up yet</p>
              <p className="text-amber-200/70 text-xs mt-1 leading-relaxed">
                Run <code className="font-mono bg-black/30 px-1 py-0.5 rounded">npm run db:seed</code> in the server
                directory to create them. <code className="font-mono bg-black/30 px-1 py-0.5 rounded">GET /api/demo/status</code>{' '}
                reports the current state.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={handleTryDemo}
              disabled={loading || selected?.available === false}
              loading={loading}
              icon={!loading ? <Sparkles size={18} /> : undefined}
              iconRight={!loading ? <ArrowRight size={16} /> : undefined}
              className="!h-[52px] !px-7 !text-[15px] !font-semibold shadow-xl shadow-brand-600/30"
            >
              {loading ? 'Loading your demo workspace…' : 'Try the live demo'}
            </Button>
            <Link
              to="/login"
              className="inline-flex items-center h-[52px] px-6 rounded-btn text-[15px] font-medium text-slate-300 border border-white/12 hover:bg-white/5 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Sign in instead
            </Link>
          </div>

          {error && (
            <p role="alert" className="text-red-300 text-sm mt-4 bg-red-500/10 border border-red-500/25 rounded-xl px-3.5 py-2.5">
              {error}
            </p>
          )}

          {/* Trust strip — answers the three objections people have before clicking. */}
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6">
            {TRUST_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
                <Icon size={13} className="text-brand-400/80 shrink-0" />
                {text}
              </li>
            ))}
          </ul>

          <p className="text-slate-500 text-xs mt-5 max-w-md leading-relaxed">
            You&rsquo;ll be signed in as a Super Admin on a shared showcase workspace. Feel free to
            click around &mdash; nothing here belongs to a real customer.
          </p>
        </div>

        {/* ── Right: product preview ─────────────────────────────────── */}
        {/* Shown from md up. Below that it is decoration competing with the CTA. */}
        <div className="hidden md:block relative">
          <div className="absolute -inset-6 bg-gradient-to-br from-brand-500/10 to-indigo-500/10 rounded-[2rem] blur-2xl pointer-events-none" />
          <div className="relative bg-slate-900/90 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Window chrome */}
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
              <span className="ml-3 text-[11px] text-slate-500 truncate font-mono">
                {window.location.host}/dashboard
                {selected ? <span className="text-slate-600"> — {selected.orgName}</span> : null}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Stat tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { icon: Ticket,      label: 'Tickets',  value: String(preview.stats.openTickets) },
                  { icon: Wallet,      label: 'Pipeline', value: compactMoney(preview.stats.pipelineValue, currency) },
                  { icon: TrendingUp,  label: 'Win rate', value: `${preview.stats.winRate}%` },
                  { icon: UserSquare2, label: 'People',   value: String(preview.stats.employees) },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 text-slate-500 text-[11px] mb-1.5">
                      <Icon size={12} /> {label}
                    </div>
                    <p className="text-lg font-bold text-white tracking-tight truncate">{value}</p>
                  </div>
                ))}
              </div>

              {/* Tickets list */}
              <div className={`${PANEL} p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <AlertTriangle size={13} className="text-amber-400" /> Recent tickets
                  </p>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                  </span>
                </div>
                <div className="space-y-2">
                  {preview.tickets.map(t => (
                    <div key={t.title} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-300 truncate">{t.title}</span>
                      <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-medium ${PRIORITY_STYLES[t.priority] ?? PRIORITY_STYLES.LOW}`}>
                        {t.priority}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deals list */}
              <div className={`${PANEL} p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-emerald-400" /> Deal pipeline
                  </p>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1"><Clock size={10} /> Updated now</span>
                </div>
                <div className="space-y-2">
                  {preview.deals.map(d => (
                    <div key={d.title} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-300 truncate">{d.title}</span>
                      <span className="shrink-0 flex items-center gap-2">
                        <span className="text-slate-500 hidden sm:inline">{d.stage}</span>
                        <span className="text-emerald-300 font-semibold">{compactMoney(d.value, currency)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── What's inside ────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 lg:px-10 pb-20">
        <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-5">
          What&rsquo;s inside
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {HIGHLIGHTS.map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className={`${PANEL} p-5 transition-colors hover:bg-white/[0.07] hover:border-white/20`}
            >
              <div className="w-9 h-9 rounded-xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center mb-3">
                <Icon size={17} className="text-brand-300" />
              </div>
              <p className="text-sm font-semibold text-white">{label}</p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/[0.07]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-7 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs">
            <img src={asset("logo.svg")} alt="" className="w-4 h-4 opacity-60" />
            <span>CRMITdesk Evolved &mdash; CRM, IT Desk, HR and AI in one workspace</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-slate-500">
            <Link to="/login" className="hover:text-slate-300 transition-colors">Sign in</Link>
            <span aria-hidden="true" className="text-slate-700">&middot;</span>
            <span>Demo data resets nightly</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
