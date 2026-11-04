import axios from 'axios';
import { addToast } from '../shared/components/toastStore';

// VITE_API_URL is required whenever the frontend and backend are on different
// origins (e.g. Netlify frontend + Render backend) — this used to be
// hardcoded to '/api', silently ignoring the env var entirely. That only
// ever worked by accident on Render's own static-site option, which has an
// explicit /api/* redirect proxy in render.yaml papering over it; any other
// host (Netlify included) sent every request to its own domain instead of
// the API, which doesn't exist there.
// 60s timeout: long enough to survive a Render cold-start wake (the server
// spins down when idle and the first request can take 30–40s to boot),
// short enough that a genuinely hung request eventually fails instead of
// spinning forever.
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 60_000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A "transient" failure is the server being unreachable or still waking up —
// no HTTP response at all (network error / timeout), or a gateway status
// Render returns while the instance boots (502/503/504). These are NOT
// authentication failures: a login or refresh that hits one should be
// retried, and must never be reported to the user as "invalid credentials"
// or treated as an expired session.
export function isTransientError(err: any): boolean {
  if (!err?.response) return true;                       // network error / timeout
  const s = err.response.status;
  return s === 502 || s === 503 || s === 504;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * POST an auth endpoint (login / refresh) with a couple of automatic retries
 * on transient failures, so a Render cold-start wake shows up as "took a few
 * seconds" rather than a spurious failure. Real 4xx (bad credentials,
 * invalid refresh token) are returned immediately — they are not retried.
 */
export async function authPost(url: string, body: any, retries = 2): Promise<any> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await api.post(url, body);
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === retries) throw err;
      await sleep(1500 * (attempt + 1)); // 1.5s, then 3s
    }
  }
  throw lastErr;
}

// The refresh endpoint rotates the refresh token (invalidates the old one,
// issues a new pair — see auth.controller.ts refreshToken). A page like the
// dashboard fires several requests in parallel on mount; if the access token
// happened to expire right then, EVERY one of those requests would 401 at
// once and — without this — each would independently call /auth/refresh
// with the same (soon-to-be-invalidated) refresh token. Only the first of
// those calls succeeds; the rest get "Invalid refresh token" back, and each
// one wiped localStorage and hard-redirected to /login in response — even
// though the very first refresh had just succeeded and the session was
// completely fine. That's the "loads, spins for a bit, then dumps you on
// the login screen" bug: it wasn't really an expired session, just this
// race. The fix is to share a single in-flight refresh across every
// concurrent 401 instead of letting each request start its own.
let refreshPromise: Promise<{ access: string; refresh?: string }> | null = null;
let loggedOutFromExpiry = false;
// Set by ensureFreshToken() when a refresh attempt comes back 401 — i.e. the
// refresh token is genuinely invalid/expired, so the session really is over.
// A transient failure (server waking up, network blip) leaves this false, so
// the interceptor keeps the user signed in instead of dumping them to /login.
let refreshWasUnauthorized = false;

// AuthContext's `accessToken` React state is only ever set by login/setSession
// — a background refresh triggered here writes straight to localStorage and
// has no way to tell React about it. Any consumer that reads the token from
// `useAuth()` (useSSE's EventSource URL, notably) then keeps using the now-
// replaced-but-still-in-state-as-old token indefinitely. AuthContext
// subscribes to this on mount and mirrors whatever comes through into its
// own state, so every consumer of useAuth().accessToken stays correct
// without each of them needing their own refresh-awareness.
let tokenListener: ((token: string) => void) | null = null;
export function onAccessTokenRefreshed(cb: (token: string) => void) {
  tokenListener = cb;
}

function performRefresh() {
  if (!refreshPromise) {
    const refresh = localStorage.getItem('refreshToken');
    // authPost (not a bare axios call) so a refresh that lands mid-cold-start
    // retries instead of failing — a failed refresh is what logs the user
    // out, so it must not fail just because the server was waking up.
    refreshPromise = authPost('/auth/refresh', { refresh })
      .then(res => res.data)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * Public wrapper so code outside the 401 interceptor (useSSE's onerror) can
 * proactively trigger the same refresh instead of only ever reacting to a
 * failed REST call. Shares performRefresh()'s single in-flight promise, so
 * a proactive call here and an automatic one from a concurrent 401 never
 * race each other into two separate refresh requests. Returns null (never
 * throws) on failure — callers just treat that as "couldn't refresh, same
 * as before."
 */
export async function ensureFreshToken(): Promise<string | null> {
  try {
    const data = await performRefresh();
    localStorage.setItem('accessToken', data.access);
    if (data.refresh) localStorage.setItem('refreshToken', data.refresh);
    tokenListener?.(data.access);
    refreshWasUnauthorized = false;
    return data.access;
  } catch (err) {
    // Distinguish "the refresh token is dead" (real 401 → session is over)
    // from "couldn't reach the server right now" (transient → keep the
    // session). The interceptor uses this flag to decide whether to log out.
    refreshWasUnauthorized = (err as any)?.response?.status === 401;
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // 401: try token refresh first — but never intercept the login/refresh endpoints themselves
    const requestUrl: string = original?.url ?? '';
    const isAuthEndpoint =
      requestUrl.includes('/auth/login') || requestUrl.includes('/auth/refresh');

    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      const newToken = await ensureFreshToken();
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      // Only hard-log-out when the refresh token itself was rejected (401).
      // If the refresh merely couldn't reach the server (cold start, network
      // blip), keep the session and let this one request fail — clearing
      // localStorage here is exactly what threw freshly-logged-in users back
      // to the login screen "with a credentials error" when the server was
      // waking up.
      if (refreshWasUnauthorized && !loggedOutFromExpiry) {
        loggedOutFromExpiry = true;
        addToast('Your session has expired — please sign in again.', 'warning', { duration: 6000 });
        localStorage.clear();
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // Show toast for all other non-401 errors
    const status: number | undefined = error.response?.status;
    const serverMsg: string | undefined =
      error.response?.data?.error || error.response?.data?.message;

    /* Was this something the user did, or something a screen fetched on its
       own? A GET is the app reading data — the user did not "perform an
       action", so a refusal is not news they asked for. Anything that writes
       (POST/PATCH/PUT/DELETE) was provoked by a click, and being told why it
       did nothing is exactly what the user needs.

       This distinction is why permission warnings used to pile up. Every role
       except SUPER_ADMIN loads at least one screen that reads endpoints it is
       not cleared for — the dashboard alone fires four such reads for IT_AGENT
       and EMPLOYEE, three for IT_MANAGER, two for SALES_REP, one for
       CRM_MANAGER — and for EMPLOYEE the sidebar's custom-module lookup fires
       on every single navigation. All of those are passive GETs, so all of them
       raised "You don't have permission to perform this action." at someone who
       had merely logged in or changed page.

       Pages now avoid firing reads they know they can't make (see
       shared/permissions.ts); this is the backstop for any that slip through.
       A blocked read degrades to an empty or hidden section, which is what the
       screen should have rendered for that role anyway. */
    const method = String(original?.method ?? 'get').toUpperCase();
    const isUserAction = method !== 'GET' && method !== 'HEAD';

    if (!error.response) {
      addToast(
        'Cannot reach the server. Make sure the backend is running and the database is connected.',
        'error'
      );
    } else if (status === 403) {
      /* Prefer the server's own wording: controllers frequently explain the
         specific rule ("Only the assigned agent can resolve this ticket"),
         which is far more actionable than the generic sentence. */
      if (isUserAction) {
        addToast(serverMsg || "You don't have permission to do that.", 'warning');
      }
    } else if (status === 402) {
      addToast(serverMsg || "You've hit your plan's seat limit.", 'warning', {
        duration: 10000,
        actionLabel: 'Upgrade plan',
        actionHref: '/billing',
      });
    } else if (status === 409) {
      addToast(serverMsg || 'A conflict occurred — this item may already exist.', 'warning');
    } else if (status === 422) {
      addToast(serverMsg || 'Validation failed — check your inputs.', 'warning');
    } else if (status === 429) {
      addToast('Too many requests — please slow down.', 'warning');
    } else if (status && status >= 500) {
      addToast(
        serverMsg ? `Server error: ${serverMsg}` : 'A server error occurred. Try again in a moment.',
        'error'
      );
    } else if (status && status >= 400 && status !== 401) {
      addToast(serverMsg || 'Something went wrong.', 'error');
    }

    return Promise.reject(error);
  }
);
