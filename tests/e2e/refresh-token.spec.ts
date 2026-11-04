import { test, expect, request } from '@playwright/test';

const API = 'http://localhost:4000';

/** Helper: log in via API and return { access, refresh, user } */
async function apiLogin(email = 'admin@crmitdesk.com', password = 'Admin@123') {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{ access: string; refresh: string; user: any }>;
}

/** Helper: call /auth/refresh with a given refresh token */
async function apiRefresh(refresh: string) {
  const ctx = await request.newContext();
  return ctx.post(`${API}/api/auth/refresh`, { data: { refresh } });
}

/** Helper: call /auth/logout with a given refresh token */
async function apiLogout(refresh: string, access: string) {
  const ctx = await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${access}` },
  });
  return ctx.post(`${API}/api/auth/logout`, { data: { refresh } });
}

// ──────────────────────────────────────────────────────────────
// Token shape
// ──────────────────────────────────────────────────────────────
test.describe('Refresh token shape', () => {
  test('login issues a 128-char hex refresh token (not a JWT)', async () => {
    const { refresh } = await apiLogin();
    expect(refresh).toMatch(/^[a-f0-9]{128}$/);
  });

  test('login issues a JWT access token (3-part dot-separated)', async () => {
    const { access } = await apiLogin();
    expect(access.split('.')).toHaveLength(3);
  });
});

// ──────────────────────────────────────────────────────────────
// Token rotation
// ──────────────────────────────────────────────────────────────
test.describe('Refresh token rotation', () => {
  test('/auth/refresh returns new access + refresh tokens', async () => {
    const { refresh: r1 } = await apiLogin();
    const res = await apiRefresh(r1);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.access).toBe('string');
    expect(typeof body.refresh).toBe('string');
    expect(body.refresh).toMatch(/^[a-f0-9]{128}$/);
  });

  test('rotated refresh token is different from original', async () => {
    const { refresh: r1 } = await apiLogin();
    const res = await apiRefresh(r1);
    const { refresh: r2 } = await res.json();
    expect(r2).not.toBe(r1);
  });

  test('old refresh token is invalid after rotation (replay attack prevented)', async () => {
    const { refresh: r1 } = await apiLogin();

    // Use it once — issues r2
    const res1 = await apiRefresh(r1);
    expect(res1.ok()).toBeTruthy();

    // Try to reuse r1 — must be rejected
    const res2 = await apiRefresh(r1);
    expect(res2.status()).toBe(401);
  });

  test('chained rotation works (use r2 to get r3)', async () => {
    const { refresh: r1 } = await apiLogin();
    const { refresh: r2 } = await (await apiRefresh(r1)).json();
    const res = await apiRefresh(r2);
    expect(res.ok()).toBeTruthy();
    const { refresh: r3 } = await res.json();
    expect(r3).not.toBe(r2);
  });

  test('new access token from /refresh is accepted by protected endpoints', async () => {
    const { refresh: r1 } = await apiLogin();
    const { access: newAccess } = await (await apiRefresh(r1)).json();

    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${newAccess}` },
    });
    const res = await ctx.get(`${API}/api/crm/contacts`);
    // 200 OK or any non-401 (empty org is fine)
    expect(res.status()).not.toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────
// Logout / revocation
// ──────────────────────────────────────────────────────────────
test.describe('Logout revokes refresh token', () => {
  test('/auth/logout returns 200', async () => {
    const { access, refresh } = await apiLogin();
    const res = await apiLogout(refresh, access);
    expect(res.ok()).toBeTruthy();
  });

  test('refresh token is invalid after logout', async () => {
    const { access, refresh } = await apiLogin();
    await apiLogout(refresh, access);

    // Try to use the revoked refresh token
    const res = await apiRefresh(refresh);
    expect(res.status()).toBe(401);
  });

  test('access token still works briefly after logout (stateless, expires on its own)', async () => {
    // Access tokens are short-lived JWTs — logout only kills the refresh token.
    // The access token remains valid until it expires (15 min).
    // This is by design. This test documents the expected behaviour.
    const { access, refresh } = await apiLogin();
    await apiLogout(refresh, access);

    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${access}` },
    });
    const res = await ctx.get(`${API}/api/auth/me`);
    // Still 200 — access token hasn't expired
    expect(res.status()).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────────
test.describe('Refresh token edge cases', () => {
  test('missing refresh token returns 400', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API}/api/auth/refresh`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('garbage string as refresh token returns 401', async () => {
    const res = await apiRefresh('notarealtoken');
    expect(res.status()).toBe(401);
  });

  test('logout with no refresh token body is graceful (200)', async () => {
    const { access } = await apiLogin();
    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${access}` },
    });
    // Logout without sending a refresh token — should not crash
    const res = await ctx.post(`${API}/api/auth/logout`, { data: {} });
    expect(res.ok()).toBeTruthy();
  });
});
