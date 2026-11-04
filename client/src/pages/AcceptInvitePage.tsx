import { asset } from '../shared/asset';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, EmptyState, Field, Input, Spinner } from '../shared/components';

type Status = 'validating' | 'ready' | 'invalid' | 'success';

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [status, setStatus] = useState<Status>('validating');
  const [inviteInfo, setInviteInfo] = useState<{ email: string; orgName?: string } | null>(null);
  const [form, setForm] = useState({ name: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Validate the token on mount
  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    api.get(`/auth/invite-info?token=${token}`)
      .then(r => {
        setInviteInfo(r.data);
        setStatus('ready');
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Backend errors come back as { error }, not { message } — this was
      // reading the wrong key, so any real failure here (invite already
      // used, expired, seat limit hit, email already registered) silently
      // fell through to the generic "Something went wrong" text instead of
      // telling the person what actually happened.
      const res = await api.post('/auth/accept-invite', { token, name: form.name, password: form.password });
      setStatus('success');
      // The endpoint already returns a fresh session — sign the person in
      // immediately and drop them on the dashboard instead of bouncing them
      // to /login to re-type the password they just set a second ago.
      const { user, access, refresh } = res.data;
      setSession(user, access, refresh);
      setTimeout(() => navigate('/dashboard'), 1200);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Something went wrong. The invite may have expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <Card padding="lg" className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-7">
          <img src={asset("logo.svg")} alt="" className="w-9 h-9" />
          <h1 className="text-xl font-semibold text-fg tracking-tight">CRM &amp; IT Desk</h1>
        </div>

        {status === 'validating' && <Spinner label="Validating your invite…" compact />}

        {status === 'invalid' && (
          <EmptyState
            compact
            icon={<AlertCircle />}
            title="Invalid or expired invite"
            description="This invite link is no longer valid. Ask your admin to send a new one."
            action={{ label: 'Back to sign in', onClick: () => navigate('/login') }}
          />
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center animate-fade-in">
            <span className="w-12 h-12 rounded-full bg-success-soft text-success flex items-center justify-center">
              <CheckCircle size={26} />
            </span>
            <h2 className="font-semibold text-fg tracking-tight">Account created</h2>
            <p className="text-[13px] text-fg-muted leading-relaxed">Taking you to your workspace…</p>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="mb-6 text-center">
              <h2 className="text-lg font-semibold text-fg tracking-tight">You've been invited</h2>
              {inviteInfo?.orgName && (
                <p className="text-[13px] text-fg-muted mt-1">
                  Join{' '}
                  <span className="font-medium text-fg" title={inviteInfo.orgName}>
                    {inviteInfo.orgName}
                  </span>
                </p>
              )}
              <p className="text-[13px] text-accent font-medium mt-1 truncate" title={inviteInfo?.email}>
                {inviteInfo?.email}
              </p>
            </div>

            {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Your name" required htmlFor="invite-name">
                <Input
                  id="invite-name"
                  type="text" required minLength={2} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Smith" autoComplete="name"
                />
              </Field>
              <Field label="Password" required htmlFor="invite-password">
                <Input
                  id="invite-password"
                  type="password" required minLength={8} value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 8 characters" autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm password" required htmlFor="invite-confirm">
                <Input
                  id="invite-confirm"
                  type="password" required value={form.confirmPassword}
                  onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="••••••••" autoComplete="new-password"
                />
              </Field>
              <Button type="submit" block loading={loading} className="mt-1">
                {loading ? 'Creating account…' : 'Set up account'}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
