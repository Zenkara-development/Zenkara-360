import { test, expect, request } from '@playwright/test';
import { login } from '../helpers/auth';

const API = 'http://localhost:4000';

// ──────────────────────────────────────────────────────────────
// Security headers (helmet)
// ──────────────────────────────────────────────────────────────
test.describe('Security headers', () => {
  test('health endpoint returns security headers set by helmet', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API}/health`);

    // helmet sets these on every response
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toMatch(/SAMEORIGIN|DENY/i);
    expect(res.headers()['x-xss-protection']).toBeDefined();
  });

  test('API responses do not expose X-Powered-By header', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API}/health`);
    // helmet removes this by default
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });

  test('login endpoint returns security headers', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API}/api/auth/login`, {
      data: { email: 'nobody@test.com', password: 'wrong' },
    });
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });
});

// ──────────────────────────────────────────────────────────────
// Request body size limit (1 MB)
// ──────────────────────────────────────────────────────────────
test.describe('Request body size limit', () => {
  test('rejects JSON body larger than 1 MB', async () => {
    const ctx = await request.newContext();
    // Build a payload slightly over 1 MB
    const bigPayload = { data: 'x'.repeat(1_100_000) };
    const res = await ctx.post(`${API}/api/auth/login`, {
      data: bigPayload,
    });
    // Express returns 413 Payload Too Large when body limit is exceeded
    expect(res.status()).toBe(413);
  });

  test('accepts normal-sized JSON body', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API}/api/auth/login`, {
      data: { email: 'admin@crmitdesk.com', password: 'Admin@123' },
    });
    // Should get 200 (valid creds) or 401 (wrong creds) — not 413
    expect([200, 401]).toContain(res.status());
  });
});

// ──────────────────────────────────────────────────────────────
// Rate limiting (only enforced in production — skip in dev)
// ──────────────────────────────────────────────────────────────
test.describe('Rate limiting', () => {
  test('login endpoint accepts repeated valid requests in dev mode', async () => {
    // In dev NODE_ENV, rate limiting is skipped — just verify no 429 on normal usage
    const ctx = await request.newContext();
    for (let i = 0; i < 5; i++) {
      const res = await ctx.post(`${API}/api/auth/login`, {
        data: { email: 'admin@crmitdesk.com', password: 'Admin@123' },
      });
      expect([200, 401]).toContain(res.status());
    }
  });
});

// ──────────────────────────────────────────────────────────────
// CORS
// ──────────────────────────────────────────────────────────────
test.describe('CORS', () => {
  test('API allows requests from configured CORS origin', async () => {
    const ctx = await request.newContext({ extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
    const res = await ctx.get(`${API}/health`);
    const allow = res.headers()['access-control-allow-origin'];
    expect(allow).toMatch(/localhost:5173|\*/);
  });
});

// ──────────────────────────────────────────────────────────────
// Health check endpoint
// ──────────────────────────────────────────────────────────────
test.describe('Health check', () => {
  test('GET /health returns status ok with db connected', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API}/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
    expect(body.timestamp).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────
// Auth token in responses
// ──────────────────────────────────────────────────────────────
test.describe('Auth response shape', () => {
  test('login returns access token + refresh token (not just JWT string)', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API}/api/auth/login`, {
      data: { email: 'admin@crmitdesk.com', password: 'Admin@123' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.access).toBe('string');
    expect(typeof body.refresh).toBe('string');
    // refresh token should be a hex string (64 bytes = 128 hex chars), not a JWT
    expect(body.refresh).toMatch(/^[a-f0-9]{128}$/);
    expect(body.user).toBeDefined();
    expect(body.user.id).toBeDefined();
  });

  test('access token is a valid JWT (3 dot-separated parts)', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API}/api/auth/login`, {
      data: { email: 'admin@crmitdesk.com', password: 'Admin@123' },
    });
    const { access } = await res.json();
    const parts = access.split('.');
    expect(parts).toHaveLength(3);
  });

  test('protected endpoint returns 401 without token', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API}/api/crm/contacts`);
    expect(res.status()).toBe(401);
  });

  test('protected endpoint returns 401 with invalid token', async () => {
    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: 'Bearer invalid.token.here' },
    });
    const res = await ctx.get(`${API}/api/crm/contacts`);
    expect(res.status()).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────
// UI: no sensitive data in page source
// ──────────────────────────────────────────────────────────────
test.describe('UI security', () => {
  test('login page does not expose API keys or secrets in HTML', async ({ page }) => {
    await page.goto('/login');
    const content = await page.content();
    // Should not contain raw JWT secrets or database URLs
    expect(content).not.toMatch(/JWT_SECRET|DATABASE_URL|postgresql:\/\//i);
  });

  test('dashboard redirects to login when localStorage is cleared', async ({ page }) => {
    await login(page);
    await page.evaluate(() => localStorage.clear());
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
