import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { api, authPost, onAccessTokenRefreshed } from '../api/client';

interface Org {
  id: string;
  name: string;
  slug: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string;
  avatarUrl?: string;
  orgId?: string;
  org?: Org;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
}

interface AuthContextType extends AuthState {
  /** Resolves to { requires2FA: true } instead of signing in when the account
   *  has TOTP enabled and no valid code was supplied — call again with
   *  `totpToken` set once the user enters one. */
  login: (email: string, password: string, totpToken?: string) => Promise<{ requires2FA?: boolean }>;
  /** One-click login as the public showcase account (see the "Try Demo"
   *  button on DemoLandingPage) — no credentials involved. `vertical` picks
   *  which industry showcase org to log into (see seedDemoData.ts); omitted
   *  or unrecognized falls back to the default tech/SaaS org server-side. */
  demoLogin: (vertical?: string) => Promise<void>;
  /** Logs in with a verified Google ID token — only works for an account that
   *  already linked Google from its Profile page (see ProfilePage.tsx). */
  googleLogin: (idToken: string) => Promise<void>;
  /** Submits a new-org signup request for admin approval — does not log the
   *  caller in. Resolves with the message to show once approved (an org
   *  isn't created, and no session starts, until the request is approved). */
  register: (email: string, password: string, name: string, organizationName: string) => Promise<{ message: string }>;
  /** Applies an already-fetched {user, access, refresh} triple to the current
   *  session without making its own API call — for flows that get this
   *  payload back from some other endpoint (e.g. POST /auth/accept-invite)
   *  and want to land the person straight in the app instead of bouncing
   *  them to the login screen to type the password they just set. */
  setSession: (user: User, access: string, refresh: string) => void;
  logout: () => void;
  updateProfile: (data: Partial<Pick<User, 'name' | 'email' | 'department' | 'avatarUrl'>>) => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('user');
    return { accessToken: token, user: user ? JSON.parse(user) : null };
  });

  const login = useCallback(async (email: string, password: string, totpToken?: string) => {
    // authPost retries on transient failures (Render cold-start wake) so a
    // login during a server boot doesn't spuriously fail. Real 401s (wrong
    // password) are not retried and surface immediately.
    const res = await authPost('/auth/login', { email, password, totpToken });
    if (res.data.requires2FA) return { requires2FA: true };
    const { user, access, refresh } = res.data;
    const normalized = { ...user, org: user.org ?? user.organization ?? null };
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
    localStorage.setItem('user', JSON.stringify(normalized));
    setState({ user: normalized, accessToken: access });
    return {};
  }, []);

  const demoLogin = useCallback(async (vertical?: string) => {
    const res = await api.post('/auth/demo-login', null, { params: vertical ? { vertical } : undefined });
    const { user, access, refresh } = res.data;
    const normalized = { ...user, org: user.org ?? user.organization ?? null };
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
    localStorage.setItem('user', JSON.stringify(normalized));
    setState({ user: normalized, accessToken: access });
  }, []);

  const googleLogin = useCallback(async (idToken: string) => {
    const res = await api.post('/auth/google', { idToken });
    const { user, access, refresh } = res.data;
    const normalized = { ...user, org: user.org ?? user.organization ?? null };
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
    localStorage.setItem('user', JSON.stringify(normalized));
    setState({ user: normalized, accessToken: access });
  }, []);

  const setSession = useCallback((user: User, access: string, refresh: string) => {
    const normalized = { ...user, org: user.org ?? (user as any).organization ?? null };
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
    localStorage.setItem('user', JSON.stringify(normalized));
    setState({ user: normalized, accessToken: access });
  }, []);

  const register = useCallback(async (email: string, password: string, name: string, organizationName: string) => {
    const res = await api.post('/auth/register', { email, password, name, organizationName });
    // No org/user exists yet and no session starts — the request just sits
    // pending until an admin approves it via the emailed /approve-org link.
    return { message: res.data.message as string };
  }, []);

  const logout = useCallback(() => {
    localStorage.clear();
    setState({ user: null, accessToken: null });
  }, []);

  const updateProfile = useCallback(async (data: Partial<Pick<User, 'name' | 'email' | 'department' | 'avatarUrl'>>) => {
    const res = await api.put('/auth/me', data);
    const updated: User = { ...res.data, org: res.data.org ?? res.data.organization ?? null };
    localStorage.setItem('user', JSON.stringify(updated));
    setState(prev => ({ ...prev, user: updated }));
  }, []);

  // api/client.ts's interceptor rotates the access token in the background
  // on any 401 (and useSSE can now trigger the same rotation proactively) —
  // it writes straight to localStorage since it's a plain module with no
  // access to this component's state. Without this subscription,
  // useAuth().accessToken would silently go stale the moment the first
  // background refresh happened, even though every axios-based request kept
  // working fine (axios re-reads localStorage per-request, not this state).
  useEffect(() => {
    onAccessTokenRefreshed(token => {
      setState(prev => (prev.accessToken === token ? prev : { ...prev, accessToken: token }));
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, demoLogin, googleLogin, register, setSession, logout, updateProfile, isAuthenticated: !!state.user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
