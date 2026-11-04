import { test, expect, request } from '@playwright/test';

const API = 'http://localhost:4000';

/** Get a bearer token for the admin user */
async function getToken() {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API}/api/auth/login`, {
    data: { email: 'admin@crmitdesk.com', password: 'Admin@123' },
  });
  const { access } = await res.json();
  return access as string;
}

/** Authenticated request context */
async function authCtx(token: string) {
  return request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

// ──────────────────────────────────────────────────────────────
// Paginated response shape
// ──────────────────────────────────────────────────────────────
test.describe('Paginated response shape', () => {
  let token: string;
  test.beforeAll(async () => { token = await getToken(); });

  const endpoints = [
    { name: 'contacts',  path: '/api/crm/contacts' },
    { name: 'accounts',  path: '/api/crm/accounts' },
    { name: 'leads',     path: '/api/crm/leads' },
    { name: 'deals',     path: '/api/crm/deals' },
    { name: 'tickets',   path: '/api/itdesk/tickets' },
    { name: 'articles',  path: '/api/itdesk/articles' },
    { name: 'users',     path: '/api/admin/users' },
  ];

  for (const { name, path } of endpoints) {
    test(`${name} list returns { data, pagination } envelope`, async () => {
      const ctx = await authCtx(token);
      const res = await ctx.get(`${API}${path}`);
      expect(res.ok()).toBeTruthy();

      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.pagination).toBe('object');
      expect(typeof body.pagination.total).toBe('number');
      expect(typeof body.pagination.page).toBe('number');
      expect(typeof body.pagination.limit).toBe('number');
      expect(typeof body.pagination.totalPages).toBe('number');
      expect(typeof body.pagination.hasNext).toBe('boolean');
      expect(typeof body.pagination.hasPrev).toBe('boolean');
    });
  }
});

// ──────────────────────────────────────────────────────────────
// Default pagination values
// ──────────────────────────────────────────────────────────────
test.describe('Default pagination values', () => {
  let token: string;
  test.beforeAll(async () => { token = await getToken(); });

  test('default page is 1', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts`);
    const { pagination } = await res.json();
    expect(pagination.page).toBe(1);
  });

  test('default limit is 50', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts`);
    const { pagination } = await res.json();
    expect(pagination.limit).toBe(50);
  });

  test('hasPrev is false on first page', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts`);
    const { pagination } = await res.json();
    expect(pagination.hasPrev).toBe(false);
  });

  test('page 1 with no records: total=0, totalPages=0, hasNext=false', async () => {
    // tickets might be empty in a fresh test environment
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/itdesk/tickets`);
    const { pagination } = await res.json();
    expect(pagination.page).toBe(1);
    if (pagination.total === 0) {
      expect(pagination.totalPages).toBe(0);
      expect(pagination.hasNext).toBe(false);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// Custom page and limit params
// ──────────────────────────────────────────────────────────────
test.describe('Custom page/limit params', () => {
  let token: string;
  test.beforeAll(async () => { token = await getToken(); });

  test('limit=1 returns at most 1 record', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?limit=1`);
    const { data, pagination } = await res.json();
    expect(data.length).toBeLessThanOrEqual(1);
    expect(pagination.limit).toBe(1);
  });

  test('limit=5 is reflected in pagination response', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/itdesk/tickets?limit=5`);
    const { pagination } = await res.json();
    expect(pagination.limit).toBe(5);
  });

  test('page=2 is reflected in pagination response', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?page=2&limit=1`);
    const { pagination } = await res.json();
    expect(pagination.page).toBe(2);
  });

  test('limit is capped at 200 (MAX_LIMIT)', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?limit=9999`);
    const { pagination } = await res.json();
    expect(pagination.limit).toBeLessThanOrEqual(200);
  });

  test('invalid page param falls back to page 1', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?page=abc`);
    const { pagination } = await res.json();
    expect(pagination.page).toBe(1);
  });

  test('negative page param falls back to page 1', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?page=-5`);
    const { pagination } = await res.json();
    expect(pagination.page).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────
// Pagination maths
// ──────────────────────────────────────────────────────────────
test.describe('Pagination maths', () => {
  let token: string;
  test.beforeAll(async () => { token = await getToken(); });

  test('totalPages = ceil(total / limit)', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?limit=3`);
    const { pagination } = await res.json();
    const expected = Math.ceil(pagination.total / 3);
    expect(pagination.totalPages).toBe(expected);
  });

  test('hasNext is true when page < totalPages', async () => {
    const ctx = await authCtx(token);
    // Get total first
    const r1 = await ctx.get(`${API}/api/crm/contacts?limit=1`);
    const { pagination: p1 } = await r1.json();
    if (p1.total > 1) {
      // Page 1 of a multi-page result should have hasNext = true
      expect(p1.hasNext).toBe(true);
    }
  });

  test('hasPrev is true on page 2+', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?page=2&limit=1`);
    const { pagination } = await res.json();
    // If total > 1 there is a page 2, and hasPrev must be true
    if (pagination.total > 1) {
      expect(pagination.hasPrev).toBe(true);
    }
  });

  test('data array length <= limit', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/itdesk/tickets?limit=2`);
    const { data } = await res.json();
    expect(data.length).toBeLessThanOrEqual(2);
  });
});

// ──────────────────────────────────────────────────────────────
// Pagination + filters work together
// ──────────────────────────────────────────────────────────────
test.describe('Pagination + filters', () => {
  let token: string;
  test.beforeAll(async () => { token = await getToken(); });

  test('ticket status filter still returns paginated envelope', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/itdesk/tickets?status=OPEN&limit=10`);
    expect(res.ok()).toBeTruthy();
    const { data, pagination } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(pagination.limit).toBe(10);
    // All returned tickets should be OPEN
    data.forEach((t: any) => expect(t.status).toBe('OPEN'));
  });

  test('contact search filter still returns paginated envelope', async () => {
    const ctx = await authCtx(token);
    const res = await ctx.get(`${API}/api/crm/contacts?search=E2E&limit=5`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.pagination).toBe('object');
  });
});
