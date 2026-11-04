import { asset } from '../shared/asset';
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Alert, Button, Card, Spinner } from '../shared/components';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// Public — where auth.controller.ts entraCallback lands the browser after a
// Microsoft sign-in (or a failure). Tokens travel in the URL *fragment*
// (#access=...&refresh=...), not a query string, so they never get sent to
// or logged by any server on the way here — only this page's own JS ever
// reads them. On success this mirrors what AuthContext's login()/setSession()
// normally do: stash the tokens, fetch the profile, land in the app.
export default function SsoCallbackPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const errorParam = params.get('error');
    if (errorParam) { setError(errorParam); return; }

    const access = params.get('access');
    const refresh = params.get('refresh');
    if (!access || !refresh) { setError('Sign-in did not complete — missing tokens.'); return; }

    // api's request interceptor reads accessToken straight from localStorage
    // (see api/client.ts), so this needs to be set before the /auth/me call
    // below — setSession() will set it again with the normalized user, but
    // that call itself needs a token to succeed.
    localStorage.setItem('accessToken', access);

    api.get('/auth/me')
      .then(res => {
        setSession(res.data, access, refresh);
        navigate('/dashboard', { replace: true });
      })
      .catch(() => setError('Signed in with Microsoft, but could not load your profile. Please try again.'));
  }, [navigate, setSession]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
        <Card padding="lg" className="w-full max-w-sm space-y-5">
          <Alert tone="danger" title="Sign-in failed">{error}</Alert>
          <Link to="/login" className="block">
            <Button variant="secondary" block>Back to sign in</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-canvas px-6">
      <div className="flex items-center gap-2.5 animate-fade-in">
        <img src={asset("logo.svg")} alt="" className="w-9 h-9" />
        <span className="text-xl font-semibold text-fg tracking-tight">CRM &amp; IT Desk</span>
      </div>
      <Spinner label="Finishing sign-in…" compact />
    </div>
  );
}
