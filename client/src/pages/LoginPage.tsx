import { asset } from '../shared/asset';
import { useId, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Ticket, Users, Shield, Eye, EyeOff, Sparkles, ArrowRight, UserSquare2, CheckSquare, Bot } from 'lucide-react';
import { GoogleSignInButton } from '../shared/components/GoogleSignInButton';
import { isTransientError } from '../api/client';
import {
  Alert, Button, Card, Field, FormError, IconButton, Input, Tabs,
} from '../shared/components';
import type { TabItem } from '../shared/components';

type Tab = 'login' | 'register';

const TABS: TabItem<Tab>[] = [
  { key: 'login', label: 'Sign in' },
  { key: 'register', label: 'Create account' },
];

/** Inline text link that lives inside a sentence — an action, not a control. */
const inlineLink =
  'font-medium text-accent rounded-btn hover:underline ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

function GoogleDivider() {
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return null;
  return (
    <div className="flex items-center gap-3 -my-1">
      <div className="flex-1 h-px bg-line" />
      <span className="text-[11px] text-fg-subtle">or</span>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}

const FEATURES = [
  { icon: Users,       label: 'CRM',          desc: 'Contacts, leads and pipeline' },
  { icon: Ticket,      label: 'IT Desk',      desc: 'Tickets, SLA and knowledge base' },
  { icon: UserSquare2, label: 'HR & People',  desc: 'Employees, org chart, leave and payroll' },
  { icon: CheckSquare, label: 'Work',         desc: 'One task queue and approval routing' },
  { icon: Bot,         label: 'AI',           desc: 'Scoring, triage and cited answers' },
  { icon: Shield,      label: 'Enterprise',   desc: 'Field-level permissions, audit logs, 2FA' },
];

function InputField({
  label, type = 'text', value, onChange, placeholder, required, minLength, autoComplete,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; minLength?: number; autoComplete?: string;
}) {
  const [showPw, setShowPw] = useState(false);
  const id = useId();
  const isPw = type === 'password';
  const actualType = isPw ? (showPw ? 'text' : 'password') : type;

  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          type={actualType}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className={isPw ? 'pr-10' : ''}
        />
        {isPw && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            <IconButton
              label={showPw ? 'Hide password' : 'Show password'}
              icon={showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              onClick={() => setShowPw(v => !v)}
              tabIndex={-1}
            />
          </span>
        )}
      </div>
    </Field>
  );
}

// Friendly text for ?error=... on the way back from a failed SSO redirect
// (see auth.controller.ts entraLoginRedirect — a bad/disabled/unknown
// sign-in slug bounces here rather than to a raw JSON error, since the
// person clicking the org's SSO link isn't looking at an API response).
const SSO_ERRORS: Record<string, string> = {
  sso_not_found: "That sign-in link isn't recognized. Check the link with your admin.",
  sso_disabled: 'Single sign-on is currently turned off for your organization. Sign in with your password instead.',
  sso_error: 'Something went wrong starting Microsoft sign-in. Please try again.',
};

export function LoginPage() {
  const { login, register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('login');
  const [error, setError] = useState(() => SSO_ERRORS[searchParams.get('error') || ''] || '');
  const [loading, setLoading] = useState(false);
  const [googleError, setGoogleError] = useState('');

  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [regForm, setRegForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpToken, setTotpToken] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const result = await login(loginForm.email, loginForm.password, needsTotp ? totpToken : undefined);
      if (result.requires2FA) {
        setNeedsTotp(true);
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      // A network error / timeout / gateway status is the server being
      // unreachable or waking up — NOT bad credentials. Saying "invalid
      // email or password" there sends people rechecking a password that
      // was fine. Only a real 401 is a credentials problem.
      if (isTransientError(err)) {
        setError('Could not reach the server — it may be waking up. Please wait a moment and try again.');
      } else if (needsTotp) {
        setError('Invalid or expired code. Please try again.');
      } else {
        setError('Invalid email or password. Please try again.');
      }
    } finally { setLoading(false); }
  }

  function backToPassword() {
    setNeedsTotp(false);
    setTotpToken('');
    setError('');
  }

  async function handleGoogleToken(idToken: string) {
    setGoogleError(''); setLoading(true);
    try {
      await googleLogin(idToken);
      navigate('/dashboard');
    } catch (err: any) {
      setGoogleError(err?.response?.data?.error || err?.response?.data?.message || 'Google sign-in failed. Link your Google account from Profile after signing in with your password first.');
    } finally { setLoading(false); }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (regForm.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true); setError('');
    try {
      const { message } = await register(regForm.email, regForm.password, regForm.name, regForm.organizationName);
      setPendingMessage(message);
      setRegForm({ name: '', email: '', password: '', organizationName: '' });
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Registration failed. Email may already be in use.');
    } finally { setLoading(false); }
  }

  const switchTab = (t: Tab) => { setTab(t); setError(''); setPendingMessage(''); };

  return (
    <div className="min-h-screen flex">
      {/* ── Left brand panel ──────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col w-[480px] shrink-0 bg-sidebar text-sidebar-fg px-12 py-14 relative overflow-hidden">
        {/* Subtle decorative circles */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-brand-600/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-brand-400/10 blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="flex items-center gap-3 mb-16 relative z-10">
          <img src={asset("logo.svg")} alt="Logo" className="w-10 h-10" />
          <div>
            <p className="font-bold text-lg leading-tight">CRM &amp; IT Desk</p>
            <p className="text-sidebar-muted text-xs">All-in-one business platform</p>
          </div>
        </div>

        {/* Headline */}
        <div className="relative z-10 mb-12">
          <h2 className="text-3xl font-bold leading-tight mb-4 tracking-tight">
            Run your business<br />
            from one place.
          </h2>
          <p className="text-sidebar-muted text-sm leading-relaxed">
            Customers, support tickets, employees and approvals — sharing one set of records, one
            permission model and one AI that can see across all of it.
          </p>
        </div>

        {/* Feature list */}
        <div className="relative z-10 space-y-4">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-center gap-4">
              <div className="w-9 h-9 rounded-card bg-sidebar-hover border border-sidebar-line flex items-center justify-center shrink-0">
                <Icon size={16} className="text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-sidebar-muted">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Try Demo CTA */}
        <Link
          to="/demo"
          className="mt-auto relative z-10 flex items-center justify-between gap-3 bg-sidebar-hover/60 hover:bg-sidebar-hover border border-sidebar-line rounded-card px-5 py-4 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <span className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-card bg-brand-600/20 text-brand-400 flex items-center justify-center shrink-0">
              <Sparkles size={16} />
            </span>
            <span>
              <span className="block text-sm font-semibold">Just exploring?</span>
              <span className="block text-xs text-sidebar-muted">Try the live demo — no signup needed</span>
            </span>
          </span>
          <ArrowRight size={16} className="text-sidebar-muted group-hover:text-sidebar-fg group-hover:translate-x-0.5 transition-all shrink-0" />
        </Link>

        {/* Footer note */}
        <p className="pt-6 relative z-10 text-xs text-sidebar-muted">
          Secure · Multi-tenant · Enterprise-ready
        </p>
      </div>

      {/* ── Right form panel ──────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-canvas">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 justify-center mb-6">
            <img src={asset("logo.svg")} alt="Logo" className="w-9 h-9" />
            <span className="font-bold text-xl text-fg tracking-tight">CRM &amp; IT Desk</span>
          </div>

          {/* Mobile Try Demo CTA */}
          <Link
            to="/demo"
            className="lg:hidden flex items-center justify-between gap-3 bg-surface border border-line rounded-card px-4 py-3 mb-6 shadow-ui-sm hover:border-accent transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <span className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-card bg-accent-soft text-accent-soft-fg flex items-center justify-center shrink-0">
                <Sparkles size={14} />
              </span>
              <span className="text-sm font-medium text-fg">Try the live demo</span>
            </span>
            <ArrowRight size={15} className="text-fg-subtle group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
          </Link>

          <Card padding="lg">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-fg tracking-tight">
                {tab === 'login' ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-[13px] text-fg-muted mt-1">
                {tab === 'login'
                  ? 'Sign in to your workspace'
                  : 'Get started with a free workspace'}
              </p>
            </div>

            {/* Tab switcher */}
            <Tabs<Tab>
              items={TABS}
              value={tab}
              onChange={switchTab}
              variant="segmented"
              fill
              aria-label="Sign in or create an account"
              className="mb-6"
            />

            {/* Error banner */}
            {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

            {tab === 'login' ? (
              needsTotp ? (
                <form onSubmit={handleLogin} className="space-y-5">
                  <p className="text-[13px] text-fg-muted leading-relaxed -mt-1">
                    Enter the 6-digit code from your authenticator app, or one of your backup codes.
                  </p>
                  <InputField
                    label="Authentication code" value={totpToken}
                    onChange={setTotpToken}
                    placeholder="123456" required autoComplete="one-time-code"
                  />
                  <Button type="submit" block loading={loading}>
                    {loading ? 'Verifying…' : 'Verify'}
                  </Button>
                  <p className="text-center text-xs text-fg-subtle">
                    <button type="button" onClick={backToPassword} className={inlineLink}>
                      Back to sign in
                    </button>
                  </p>
                </form>
              ) : (
              <form onSubmit={handleLogin} className="space-y-5">
                <InputField
                  label="Email address" type="email" value={loginForm.email}
                  onChange={v => setLoginForm(f => ({ ...f, email: v }))}
                  placeholder="you@company.com" required autoComplete="email"
                />
                <div className="space-y-1.5">
                  <InputField
                    label="Password" type="password" value={loginForm.password}
                    onChange={v => setLoginForm(f => ({ ...f, password: v }))}
                    placeholder="Enter your password" required autoComplete="current-password"
                  />
                  <div className="text-right">
                    <Link to="/forgot-password" className={`text-xs ${inlineLink}`}>
                      Forgot password?
                    </Link>
                  </div>
                </div>
                <Button type="submit" block loading={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>

                <GoogleDivider />
                {googleError && <FormError className="text-center -mt-2">{googleError}</FormError>}
                <div className="flex justify-center">
                  <GoogleSignInButton onIdToken={handleGoogleToken} />
                </div>

                <p className="text-center text-xs text-fg-subtle">
                  No account?{' '}
                  <button type="button" onClick={() => switchTab('register')} className={inlineLink}>
                    Create one free
                  </button>
                </p>
              </form>
              )
            ) : pendingMessage ? (
              <div className="space-y-5 py-2">
                <Alert tone="success">{pendingMessage}</Alert>
                <Button variant="secondary" block onClick={() => switchTab('login')}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <InputField
                  label="Company name" value={regForm.organizationName}
                  onChange={v => setRegForm(f => ({ ...f, organizationName: v }))}
                  placeholder="Acme Inc." required minLength={2}
                />
                <InputField
                  label="Your name" value={regForm.name}
                  onChange={v => setRegForm(f => ({ ...f, name: v }))}
                  placeholder="Jane Smith" required minLength={2}
                />
                <InputField
                  label="Work email" type="email" value={regForm.email}
                  onChange={v => setRegForm(f => ({ ...f, email: v }))}
                  placeholder="jane@acme.com" required autoComplete="email"
                />
                <InputField
                  label="Password" type="password" value={regForm.password}
                  onChange={v => setRegForm(f => ({ ...f, password: v }))}
                  placeholder="Min. 8 characters" required minLength={8} autoComplete="new-password"
                />
                <Button type="submit" block loading={loading} className="mt-1">
                  {loading ? 'Creating account…' : 'Create account'}
                </Button>
                <p className="text-center text-xs text-fg-subtle">
                  Already registered?{' '}
                  <button type="button" onClick={() => switchTab('login')} className={inlineLink}>
                    Sign in
                  </button>
                </p>
              </form>
            )}
          </Card>

          <p className="text-center text-xs text-fg-subtle mt-6">
            By signing in you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
