import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { api } from '../api/client';
import { Alert, Button, Card, Field, Input } from '../shared/components';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {
      // Server always returns a generic success message for this endpoint —
      // a request failure here means something else (network, 429, etc).
      setError('Something went wrong. Please try again in a moment.');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <Card padding="lg">
          <div className="w-11 h-11 rounded-card bg-accent-soft text-accent-soft-fg flex items-center justify-center mb-5">
            <Mail size={18} />
          </div>
          <h1 className="text-lg font-semibold text-fg tracking-tight">Reset your password</h1>

          {sent ? (
            <div className="mt-4 space-y-5">
              <p className="text-[13px] text-fg-muted leading-relaxed">
                If an account exists for <strong className="font-medium text-fg">{email}</strong>, a password reset link has been sent. Check your inbox — the link expires in 30 minutes.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent rounded-btn hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <ArrowLeft size={13} /> Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-5">
              <p className="text-[13px] text-fg-muted leading-relaxed">
                Enter your account email and we'll send you a link to reset your password.
              </p>
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Email address" htmlFor="forgot-email">
                <Input
                  id="forgot-email"
                  type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com" autoComplete="email"
                />
              </Field>
              <Button type="submit" block loading={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
              <Link
                to="/login"
                className="flex items-center justify-center gap-1.5 text-[13px] text-fg-muted rounded-btn hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <ArrowLeft size={13} /> Back to sign in
              </Link>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
