import { useEffect, useRef, useState } from 'react';

// Loads Google's Identity Services script on demand and renders the
// official "Sign in with Google" button. The client ID is not a secret
// (it's meant to be embedded in frontend code — Google's docs are explicit
// about this), so it's read from a build-time Vite env var rather than
// fetched from the API. Renders nothing if VITE_GOOGLE_CLIENT_ID isn't set,
// so orgs that haven't set up Google SSO just don't see the button at all.

declare global {
  interface Window {
    google?: any;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In script'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function GoogleSignInButton({ onIdToken, text = 'signin_with' }: { onIdToken: (idToken: string) => void; text?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogleScript().then(() => {
      if (cancelled || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential: string }) => onIdToken(resp.credential),
      });
      window.google.accounts.id.renderButton(ref.current, {
        type: 'standard', theme: 'outline', size: 'large', width: 336, text,
      });
      setReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return null;
  return <div ref={ref} className={ready ? '' : 'h-10'} />;
}
