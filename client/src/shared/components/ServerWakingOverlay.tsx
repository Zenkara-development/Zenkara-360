import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudSun } from 'lucide-react';

/**
 * Free-tier cold-start UX. The backend on Render's free plan spins down
 * after ~15 minutes without traffic; the first request after that hangs for
 * 50–90 seconds while the instance boots — which used to look like the app
 * endlessly "loading" with no explanation.
 *
 * This overlay probes the API once at boot (and again whenever the tab
 * becomes visible after being hidden for a while — the "came back after an
 * hour" case). A fast response means the server is warm and nothing is ever
 * shown. No response within the probe timeout means a cold start is in
 * progress: a full-screen "waking up" panel appears, keeps probing, and
 * removes itself the moment the server answers — at which point the app's
 * normal queries (which React Query has been retrying underneath) resolve.
 *
 * Probes use fetch(), not the shared axios instance, deliberately: the
 * axios interceptors toast "Cannot reach the server" on network errors,
 * and a probe loop must never spam toasts.
 */

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';
const PROBE_URL = `${API_BASE}/docs`;        // unauthenticated, tiny JSON
const FIRST_PROBE_TIMEOUT_MS = 3500;         // warm servers answer well under this
const RETRY_PROBE_TIMEOUT_MS = 12000;
const RETRY_EVERY_MS = 4000;
const HIDDEN_LONG_ENOUGH_MS = 10 * 60 * 1000; // re-probe after ≥10 min in a background tab

async function probe(timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Any HTTP response at all (even 4xx/5xx) proves the server is awake —
    // only a network error / timeout means it's still booting.
    await fetch(PROBE_URL, { signal: ctrl.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function ServerWakingOverlay() {
  const qc = useQueryClient();
  const [waking, setWaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const checking = useRef(false);
  const hiddenAt = useRef<number | null>(null);

  async function checkServer() {
    if (checking.current) return;
    checking.current = true;
    try {
      if (await probe(FIRST_PROBE_TIMEOUT_MS)) return; // warm — show nothing
      setWaking(true);
      setElapsed(0);
      // Keep probing until the server answers.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (await probe(RETRY_PROBE_TIMEOUT_MS)) break;
        await new Promise(r => setTimeout(r, RETRY_EVERY_MS));
      }
      setWaking(false);
      // The screens underneath fired their queries into a sleeping server —
      // some may have exhausted retries and settled into error state. Now
      // that it's awake, refetch everything so the app comes back complete
      // without a manual reload.
      qc.invalidateQueries();
    } finally {
      checking.current = false;
    }
  }

  useEffect(() => {
    checkServer();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current >= HIDDEN_LONG_ENOUGH_MS) {
        hiddenAt.current = null;
        checkServer();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!waking) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [waking]);

  if (!waking) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-canvas/95 backdrop-blur-sm">
      <div className="max-w-sm mx-4 text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-accent-soft flex items-center justify-center">
          <CloudSun size={26} className="text-accent animate-pulse" />
        </div>
        <h2 className="text-lg font-semibold text-fg mb-1.5">Waking up the server…</h2>
        <p className="text-sm text-fg-muted leading-relaxed">
          The server goes to sleep after a period of inactivity and is starting
          back up now. This usually takes under a minute — the app will continue
          automatically.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-fg-subtle">
          <span className="inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          {elapsed}s elapsed
        </div>
      </div>
    </div>
  );
}
