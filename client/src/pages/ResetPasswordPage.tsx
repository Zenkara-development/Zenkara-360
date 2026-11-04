import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { api } from '../api/client';
import { Alert, Button, Card, Field, IconButton, Input } from '../shared/components';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true); setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.response?.data?.message || 'This reset link is invalid or has expired.');
    } finally { setLoading(false); }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
        <Card padding="lg" className="w-full max-w-sm text-center">
          <p className="text-[13px] text-fg-muted leading-relaxed">This reset link is missing its token.</p>
          <Link
            to="/forgot-password"
            className="mt-4 inline-block text-[13px] font-medium text-accent rounded-btn hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Request a new link
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <Card padding="lg">
          <div className="w-11 h-11 rounded-card bg-accent-soft text-accent-soft-fg flex items-center justify-center mb-5">
            <KeyRound size={18} />
          </div>
          <h1 className="text-lg font-semibold text-fg tracking-tight">Choose a new password</h1>

          {done ? (
            <Alert tone="success" className="mt-4">
              Password reset. Redirecting you to sign in…
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-5">
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="New password" htmlFor="reset-password">
                <div className="relative">
                  <Input
                    id="reset-password"
                    type={showPw ? 'text' : 'password'} required minLength={8} value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="New password" autoComplete="new-password"
                    className="pr-10"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    <IconButton
                      label={showPw ? 'Hide password' : 'Show password'}
                      icon={showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                      onClick={() => setShowPw(v => !v)}
                      tabIndex={-1}
                    />
                  </span>
                </div>
              </Field>
              <Field label="Confirm new password" htmlFor="reset-confirm">
                <Input
                  id="reset-confirm"
                  type={showPw ? 'text' : 'password'} required minLength={8} value={confirm}
                  onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password" autoComplete="new-password"
                />
              </Field>
              <Button type="submit" block loading={loading}>
                {loading ? 'Resetting…' : 'Reset password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
