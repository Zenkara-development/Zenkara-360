import { useId, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Users, Eye, EyeOff, Sparkles, ArrowRight, Layers, Headphones, Mail, Lock, Building2, User } from 'lucide-react';
import { GoogleSignInButton } from '../shared/components/GoogleSignInButton';
import { isTransientError } from '../api/client';
import {
  Alert, Button, Field, FormError, IconButton, Input,
} from '../shared/components';

type Tab = 'login' | 'register';

/* The "Just exploring? Try the live demo" entry is hidden for now. The
   /demo route itself is untouched; flip this to bring the link back. */
const SHOW_DEMO_LINK = false;

/** Inline text link that lives inside a sentence — an action, not a control. */
const inlineLink =
  'font-medium text-accent rounded-btn hover:underline ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

function GoogleDivider() {
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return null;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-line" />
      <span className="text-[12.5px] text-fg-muted">or continue with</span>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}

/* Module tiles on the left panel: 3 on the first row, 2 centred below. */
const FEATURES = [
  { icon: Users,      label: 'CRM' },
  { icon: Layers,     label: 'Workflows' },
  { icon: Headphones, label: 'IT Desk' },
  { icon: Users,      label: 'HR & People' },
  { icon: Sparkles,   label: 'AI Insights' },
];

/** Four rounded squares in two blues: the platform mark. */
function LogoMark({ className = '' }: { className?: string }) {
  return (
    <span className={`grid grid-cols-2 gap-1 ${className}`} aria-hidden="true">
      <span className="rounded-[5px] bg-[#3F86E0]" />
      <span className="rounded-[5px] bg-[#2F6FC4]" />
      <span className="rounded-[5px] bg-[#6FA8F0]" />
      <span className="rounded-[5px] bg-[#4F92E8]" />
    </span>
  );
}

/** Deep-blue pill used for the primary submit buttons on this page. */
const navyButton =
  '!h-12 !rounded-xl !text-[15px] !font-semibold !border-0 !text-white ' +
  '!bg-gradient-to-r !from-[#0E3A84] !to-[#1E56B0] hover:!from-[#0B3070] hover:!to-[#174A9C] ' +
  '!shadow-[0_10px_22px_-10px_rgba(14,58,132,0.7)]';

function InputField({
  label, type = 'text', value, onChange, placeholder, required, minLength, autoComplete, icon, labelAction,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; minLength?: number; autoComplete?: string;
  /** Leading icon inside the box (mail, lock, ...). */
  icon?: React.ReactNode;
  /** Shown at the right end of the label row, e.g. "Forgot password?". */
  labelAction?: React.ReactNode;
}) {
  const [showPw, setShowPw] = useState(false);
  const id = useId();
  const isPw = type === 'password';
  const actualType = isPw ? (showPw ? 'text' : 'password') : type;

  return (
    <Field label={labelAction ? undefined : label} htmlFor={id}>
      {labelAction && (
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <label htmlFor={id} className="form-label !mb-0">{label}</label>
          {labelAction}
        </div>
      )}
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
          icon={icon}
          className={`!h-12 !rounded-xl !text-[14px] ${icon ? '!pl-11' : ''} ${isPw ? 'pr-11' : ''}`}
        />
        {isPw && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
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
    <div className="relative min-h-screen flex overflow-hidden bg-surface">
      {/* Deep-blue curved panel behind the card (desktop) */}
      <svg
        className="hidden lg:block absolute inset-y-0 right-0 h-full w-[56%] pointer-events-none"
        viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"
      >
        <defs>
          <linearGradient id="login-navy" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#123F8C" />
            <stop offset="100%" stopColor="#0A2C66" />
          </linearGradient>
        </defs>
        <path d="M150,0 C40,260 40,740 150,1000 L1000,1000 L1000,0 Z" fill="url(#login-navy)" />
        <path d="M1000,0 L1000,330 C860,300 760,170 780,0 Z" fill="#ffffff" opacity="0.05" />
        <path d="M110,1000 C220,800 430,760 560,1000 Z" fill="#ffffff" opacity="0.05" />
      </svg>

      {/* ── Left: platform intro ─────────────────────────────────── */}
      <div className="hidden lg:flex relative flex-col justify-center w-[46%] shrink-0 pl-[7vw] pr-10 py-14">
        <LogoMark className="w-14 h-14 mb-8" />
        <h2 className="text-[46px] xl:text-[52px] font-extrabold text-fg leading-[1.08] tracking-tight">
          Business Operations<br />Platform
        </h2>
        <p className="text-[18px] text-fg-muted leading-relaxed mt-5 max-w-[470px]">
          Manage customers, tickets, people and operations in one connected workspace.
        </p>

        <div className="mt-12 max-w-[560px] flex flex-wrap justify-center gap-3">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="w-[calc(33.333%-8px)] min-w-[112px] h-[104px] rounded-2xl bg-accent-soft/70 border border-accent/10
                         flex flex-col items-center justify-center gap-2.5 text-center"
            >
              <Icon size={30} strokeWidth={1.8} className="text-accent" />
              <span className="text-[15px] font-bold text-fg">{label}</span>
            </div>
          ))}
        </div>

        {SHOW_DEMO_LINK && (
          <Link
            to="/demo"
            className="mt-10 max-w-[560px] flex items-center justify-between gap-3 bg-surface border border-line rounded-2xl px-5 py-4 shadow-ui-sm hover:border-accent transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <span className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <Sparkles size={16} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-fg">Just exploring?</span>
                <span className="block text-xs text-fg-muted">Try the live demo — no signup needed</span>
              </span>
            </span>
            <ArrowRight size={16} className="text-fg-subtle group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        )}

        {/* Soft waves along the bottom edge */}
        <svg className="absolute bottom-0 left-0 w-full h-40 pointer-events-none" viewBox="0 0 800 160" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,70 C160,10 300,120 480,95 C620,75 700,120 800,140 L800,160 L0,160 Z" fill="rgb(var(--ui-accent))" opacity="0.07" />
          <path d="M0,110 C200,60 340,150 540,125 C660,110 740,140 800,150 L800,160 L0,160 Z" fill="rgb(var(--ui-accent))" opacity="0.06" />
        </svg>
      </div>

      {/* ── Right: sign-in card ───────────────────────────────────── */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-4 py-10 sm:px-8 lg:pr-[5vw] lg:pl-0">
        <div className="w-full max-w-[560px]">
          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-3 justify-center mb-7">
            <LogoMark className="w-9 h-9" />
            <span className="font-extrabold text-[20px] text-fg tracking-tight">Business Operations Platform</span>
          </div>

          {SHOW_DEMO_LINK && (
            <Link
              to="/demo"
              className="lg:hidden flex items-center justify-between gap-3 bg-surface border border-line rounded-2xl px-4 py-3 mb-6 shadow-ui-sm hover:border-accent transition-colors group"
            >
              <span className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <Sparkles size={14} />
                </span>
                <span className="text-sm font-medium text-fg">Try the live demo</span>
              </span>
              <ArrowRight size={15} className="text-fg-subtle group-hover:text-accent transition-all" />
            </Link>
          )}

          <div className="rounded-[28px] bg-surface border border-line/60 shadow-[0_30px_70px_-20px_rgba(6,24,64,0.45)] px-6 py-8 sm:px-11 sm:py-11">
            {/* Header */}
            <div className="mb-7">
              <h1 className="text-[30px] sm:text-[36px] font-extrabold text-fg leading-tight tracking-tight">
                {tab === 'login' ? 'Welcome Back' : 'Request a workspace'}
              </h1>
              <p className="text-[16px] sm:text-[17px] text-fg-muted mt-1">
                {tab === 'login'
                  ? 'Sign in to your workspace'
                  : 'Tell us about your company. We review every request and email you once it is approved.'}
              </p>
            </div>

            {/* Error banner */}
            {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

            {tab === 'login' ? (
              needsTotp ? (
                <form onSubmit={handleLogin} className="space-y-5">
                  <p className="text-[14px] text-fg-muted leading-relaxed -mt-1">
                    Enter the 6-digit code from your authenticator app, or one of your backup codes.
                  </p>
                  <InputField
                    label="Authentication code" value={totpToken}
                    onChange={setTotpToken}
                    placeholder="123456" required autoComplete="one-time-code" icon={<Lock size={17} />}
                  />
                  <Button type="submit" block loading={loading} className={navyButton}>
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
                  label="Work email" type="email" value={loginForm.email}
                  onChange={v => setLoginForm(f => ({ ...f, email: v }))}
                  placeholder="you@company.com" required autoComplete="email" icon={<Mail size={18} />}
                />
                <InputField
                  label="Password" type="password" value={loginForm.password}
                  onChange={v => setLoginForm(f => ({ ...f, password: v }))}
                  placeholder="Enter your password" required autoComplete="current-password" icon={<Lock size={18} />}
                  labelAction={
                    <Link to="/forgot-password" className={`text-[14px] underline underline-offset-2 ${inlineLink}`}>
                      Forgot password?
                    </Link>
                  }
                />
                <Button type="submit" block loading={loading} className={navyButton} iconRight={<ArrowRight size={17} />}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>

                <GoogleDivider />
                {googleError && <FormError className="text-center -mt-2">{googleError}</FormError>}
                <div className="flex justify-center">
                  <GoogleSignInButton onIdToken={handleGoogleToken} />
                </div>

                {/* New company: opens the existing registration form */}
                <div className="pt-2">
                  <p className="text-[17px] font-bold text-fg">New company?</p>
                  <p className="text-[14.5px] text-fg-muted mt-0.5">Request a workspace and get set up quickly.</p>
                  <button
                    type="button"
                    onClick={() => switchTab('register')}
                    className="mt-4 inline-flex items-center gap-2 h-11 px-5 rounded-xl border-2 border-accent text-accent
                               text-[14.5px] font-bold hover:bg-accent-soft transition-colors
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2"
                  >
                    Request a workspace <ArrowRight size={16} />
                  </button>
                </div>
              </form>
              )
            ) : pendingMessage ? (
              <div className="space-y-5 py-2">
                <Alert tone="success">{pendingMessage}</Alert>
                <Button block onClick={() => switchTab('login')} className={navyButton}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <InputField
                  label="Company name" value={regForm.organizationName}
                  onChange={v => setRegForm(f => ({ ...f, organizationName: v }))}
                  placeholder="Acme Inc." required minLength={2} icon={<Building2 size={18} />}
                />
                <InputField
                  label="Your name" value={regForm.name}
                  onChange={v => setRegForm(f => ({ ...f, name: v }))}
                  placeholder="Jane Smith" required minLength={2} icon={<User size={18} />}
                />
                <InputField
                  label="Work email" type="email" value={regForm.email}
                  onChange={v => setRegForm(f => ({ ...f, email: v }))}
                  placeholder="jane@acme.com" required autoComplete="email" icon={<Mail size={18} />}
                />
                <InputField
                  label="Password" type="password" value={regForm.password}
                  onChange={v => setRegForm(f => ({ ...f, password: v }))}
                  placeholder="Min. 8 characters" required minLength={8} autoComplete="new-password" icon={<Lock size={18} />}
                />
                <Button type="submit" block loading={loading} className={`mt-1 ${navyButton}`} iconRight={<ArrowRight size={17} />}>
                  {loading ? 'Sending request…' : 'Request workspace'}
                </Button>
                <p className="text-center text-[13.5px] text-fg-muted">
                  Already registered?{' '}
                  <button type="button" onClick={() => switchTab('login')} className={inlineLink}>
                    Sign in
                  </button>
                </p>
              </form>
            )}
          </div>

          <p className="text-center text-xs text-fg-subtle lg:text-white/70 mt-6">
            By signing in you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
