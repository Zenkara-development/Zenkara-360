/**
 * rbac.spec.ts — Role-Based Access Control (API-level)
 *
 * Tests the backend API directly using Playwright's request fixture to verify
 * that requireRole() middleware enforces 403 for unauthorised roles.
 *
 * Strategy:
 *   1. Login via POST /api/auth/login to obtain a JWT per role
 *   2. Hit each protected endpoint with the token
 *   3. Assert 403 for blocked roles, < 400 for allowed roles
 *
 * Seeded credentials (all password: Admin@123):
 *   admin@crmitdesk.com       SUPER_ADMIN
 *   crm@crmitdesk.com         CRM_MANAGER
 *   sales@crmitdesk.com       SALES_REP
 *   itmanager@crmitdesk.com   IT_MANAGER
 *   itagent@crmitdesk.com     IT_AGENT
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';

const API = 'http://localhost:4000';

const CREDS = {
  SUPER_ADMIN: { email: 'admin@crmitdesk.com',     password: 'Admin@123' },
  IT_MANAGER:  { email: 'itmanager@crmitdesk.com', password: 'Admin@123' },
  CRM_MANAGER: { email: 'crm@crmitdesk.com',       password: 'Admin@123' },
  IT_AGENT:    { email: 'itagent@crmitdesk.com',   password: 'Admin@123' },
  SALES_REP:   { email: 'sales@crmitdesk.com',     password: 'Admin@123' },
} as const;

type Role = keyof typeof CREDS;

// ── helpers ───────────────────────────────────────────────────────────────────

async function getToken(ctx: APIRequestContext, role: Role): Promise<string> {
  const { email, password } = CREDS[role];
  const res = await ctx.post(`${API}/api/auth/login`, { data: { email, password } });
  const body = await res.json();
  return body.access ?? '';
}

function auth(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function GET(ctx: APIRequestContext, token: string, path: string) {
  return ctx.get(`${API}${path}`, auth(token));
}

async function POST(ctx: APIRequestContext, token: string, path: string, data: object = {}) {
  return ctx.post(`${API}${path}`, { ...auth(token), data });
}

async function PATCH(ctx: APIRequestContext, token: string, path: string, data: object = {}) {
  return ctx.patch(`${API}${path}`, { ...auth(token), data });
}

async function DELETE(ctx: APIRequestContext, token: string, path: string) {
  return ctx.delete(`${API}${path}`, auth(token));
}

// Convenience: assert a set of roles get the expected status on a GET
async function assertAccess(
  ctx: APIRequestContext,
  tokens: Record<Role, string>,
  path: string,
  { allowed, blocked }: { allowed: Role[]; blocked: Role[] }
) {
  for (const role of allowed) {
    const res = await GET(ctx, tokens[role], path);
    expect(res.status(), `${role} should be allowed on GET ${path}`).toBeLessThan(400);
  }
  for (const role of blocked) {
    const res = await GET(ctx, tokens[role], path);
    expect(res.status(), `${role} should be 403 on GET ${path}`).toBe(403);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('RBAC — Role-Based Access Control', () => {
  // Shared context + token map for the entire suite
  let ctx: APIRequestContext;
  let tokens: Record<Role, string>;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    tokens = {
      SUPER_ADMIN: await getToken(ctx, 'SUPER_ADMIN'),
      IT_MANAGER:  await getToken(ctx, 'IT_MANAGER'),
      CRM_MANAGER: await getToken(ctx, 'CRM_MANAGER'),
      IT_AGENT:    await getToken(ctx, 'IT_AGENT'),
      SALES_REP:   await getToken(ctx, 'SALES_REP'),
    };
  });

  test.afterAll(async () => {
    await ctx.dispose();
  });

  // ── 1. Unauthenticated requests → 401 ──────────────────────────────────────
  test.describe('Unauthenticated → 401', () => {
    const paths = [
      '/api/itdesk/tickets',
      '/api/itdesk/assets',
      '/api/crm/contacts',
      '/api/crm/leads',
      '/api/crm/deals',
      '/api/analytics/overview',
      '/api/audit-logs',
      '/api/api-keys',
      '/api/billing/subscription',
      '/api/workflows',
      '/api/reports/tickets',
      '/api/reports/crm',
    ];

    for (const path of paths) {
      test(`GET ${path} without token → 401`, async () => {
        const res = await ctx.get(`${API}${path}`);
        expect(res.status()).toBe(401);
      });
    }
  });

  // ── 2. IT Desk routes ───────────────────────────────────────────────────────
  test.describe('IT Desk routes', () => {

    test('GET /api/itdesk/tickets — ALL_USERS can read', async () => {
      await assertAccess(ctx, tokens, '/api/itdesk/tickets', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
        blocked: [],
      });
    });

    test('GET /api/itdesk/categories — ALL_USERS can read', async () => {
      await assertAccess(ctx, tokens, '/api/itdesk/categories', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
        blocked: [],
      });
    });

    test('POST /api/itdesk/categories — only IT_MANAGERS allowed', async () => {
      const allowed: Role[] = ['SUPER_ADMIN', 'IT_MANAGER'];
      const blocked: Role[] = ['CRM_MANAGER', 'IT_AGENT', 'SALES_REP'];

      for (const role of allowed) {
        const res = await POST(ctx, tokens[role], '/api/itdesk/categories', { name: `RBAC Cat ${role}`, description: 'rbac test' });
        expect(res.status(), `${role} create category`).not.toBe(403);
      }
      for (const role of blocked) {
        const res = await POST(ctx, tokens[role], '/api/itdesk/categories', { name: `RBAC Cat ${role}` });
        expect(res.status(), `${role} create category should be 403`).toBe(403);
      }
    });

    test('GET /api/itdesk/articles — ALL_USERS can read', async () => {
      await assertAccess(ctx, tokens, '/api/itdesk/articles', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
        blocked: [],
      });
    });

    test('POST /api/itdesk/articles — only IT_STAFF allowed', async () => {
      const allowed: Role[] = ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'];
      const blocked: Role[] = ['CRM_MANAGER', 'SALES_REP'];

      for (const role of allowed) {
        const res = await POST(ctx, tokens[role], '/api/itdesk/articles', { title: `RBAC Art ${role}`, body: 'test', status: 'DRAFT' });
        expect(res.status(), `${role} create article`).not.toBe(403);
      }
      for (const role of blocked) {
        const res = await POST(ctx, tokens[role], '/api/itdesk/articles', { title: `RBAC Art ${role}`, body: 'test', status: 'DRAFT' });
        expect(res.status(), `${role} create article should be 403`).toBe(403);
      }
    });

    test('GET /api/itdesk/assets — only IT_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/itdesk/assets', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'],
        blocked: ['CRM_MANAGER', 'SALES_REP'],
      });
    });

    test('POST /api/itdesk/assets — only IT_MANAGERS allowed', async () => {
      for (const role of ['IT_AGENT', 'CRM_MANAGER', 'SALES_REP'] as Role[]) {
        const res = await POST(ctx, tokens[role], '/api/itdesk/assets', {
          name: 'RBAC Asset', assetType: 'Laptop', status: 'ACTIVE',
        });
        expect(res.status(), `${role} create asset should be 403`).toBe(403);
      }
    });

    test('GET /api/itdesk/sla-policies — only IT_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/itdesk/sla-policies', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'],
        blocked: ['CRM_MANAGER', 'SALES_REP'],
      });
    });

    test('POST /api/itdesk/sla-policies — only IT_MANAGERS allowed', async () => {
      // IT_AGENT can read but not create
      const agentRes = await POST(ctx, tokens.IT_AGENT, '/api/itdesk/sla-policies', {
        name: 'RBAC SLA', responseHours: 4, resolutionHours: 8, priority: 'HIGH',
      });
      expect(agentRes.status(), 'IT_AGENT create SLA should be 403').toBe(403);

      // IT_MANAGER can create
      const managerRes = await POST(ctx, tokens.IT_MANAGER, '/api/itdesk/sla-policies', {
        name: 'RBAC SLA Manager', responseHours: 4, resolutionHours: 8, priority: 'HIGH',
      });
      expect(managerRes.status(), 'IT_MANAGER create SLA').not.toBe(403);
    });

    test('PATCH /api/itdesk/tickets/:id/assign — only IT_MANAGERS allowed', async () => {
      // Get any ticket ID
      const listRes = await GET(ctx, tokens.SUPER_ADMIN, '/api/itdesk/tickets');
      const body = await listRes.json();
      const ticketList = body.data ?? body;
      if (!Array.isArray(ticketList) || ticketList.length === 0) {
        test.skip();
        return;
      }
      const ticketId = ticketList[0].id;

      // IT_AGENT cannot assign
      const agentRes = await PATCH(ctx, tokens.IT_AGENT, `/api/itdesk/tickets/${ticketId}/assign`, { assignedTo: null });
      expect(agentRes.status(), 'IT_AGENT assign ticket should be 403').toBe(403);

      // IT_MANAGER can assign
      const managerRes = await PATCH(ctx, tokens.IT_MANAGER, `/api/itdesk/tickets/${ticketId}/assign`, { assignedTo: null });
      expect(managerRes.status(), 'IT_MANAGER assign ticket').not.toBe(403);
    });

    test('DELETE /api/itdesk/tickets/:id — only IT_MANAGERS allowed', async () => {
      // Just verify the 403, not actual deletion (use non-existent ID)
      const agentRes = await DELETE(ctx, tokens.IT_AGENT, '/api/itdesk/tickets/non-existent');
      expect(agentRes.status(), 'IT_AGENT delete ticket').toBe(403);

      const salesRes = await DELETE(ctx, tokens.SALES_REP, '/api/itdesk/tickets/non-existent');
      expect(salesRes.status(), 'SALES_REP delete ticket').toBe(403);
    });

    test('GET /api/reports/tickets — only IT_MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/reports/tickets', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER'],
        blocked: ['CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });
  });

  // ── 3. CRM routes ───────────────────────────────────────────────────────────
  test.describe('CRM routes', () => {

    test('GET /api/crm/contacts — only CRM_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/crm/contacts', {
        allowed: ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'],
        blocked: ['IT_MANAGER', 'IT_AGENT'],
      });
    });

    test('DELETE /api/crm/contacts/:id — only CRM_MANAGERS allowed', async () => {
      // SALES_REP can read but not delete
      const salesRes = await DELETE(ctx, tokens.SALES_REP, '/api/crm/contacts/non-existent');
      expect(salesRes.status(), 'SALES_REP delete contact should be 403').toBe(403);

      // IT roles also blocked
      for (const role of ['IT_MANAGER', 'IT_AGENT'] as Role[]) {
        const res = await DELETE(ctx, tokens[role], '/api/crm/contacts/non-existent');
        expect(res.status(), `${role} delete contact should be 403`).toBe(403);
      }
    });

    test('GET /api/crm/leads — only CRM_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/crm/leads', {
        allowed: ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'],
        blocked: ['IT_MANAGER', 'IT_AGENT'],
      });
    });

    test('GET /api/crm/deals — only CRM_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/crm/deals', {
        allowed: ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'],
        blocked: ['IT_MANAGER', 'IT_AGENT'],
      });
    });

    test('GET /api/crm/accounts — only CRM_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/crm/accounts', {
        allowed: ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'],
        blocked: ['IT_MANAGER', 'IT_AGENT'],
      });
    });

    test('GET /api/quotes — only CRM_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/quotes', {
        allowed: ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'],
        blocked: ['IT_MANAGER', 'IT_AGENT'],
      });
    });

    test('GET /api/campaigns — CRM_STAFF can read, IT staff blocked', async () => {
      await assertAccess(ctx, tokens, '/api/campaigns', {
        allowed: ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'],
        blocked: ['IT_MANAGER', 'IT_AGENT'],
      });
    });

    test('POST /api/campaigns — only CRM_MANAGERS can create', async () => {
      // SALES_REP can read but not create
      const salesRes = await POST(ctx, tokens.SALES_REP, '/api/campaigns', {
        name: 'RBAC Campaign', subject: 'Test', body: 'Hello',
      });
      expect(salesRes.status(), 'SALES_REP create campaign should be 403').toBe(403);
    });

    test('POST /api/import/contacts — only CRM_MANAGERS allowed', async () => {
      for (const role of ['IT_MANAGER', 'IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await POST(ctx, tokens[role], '/api/import/contacts', { records: [] });
        expect(res.status(), `${role} import contacts should be 403`).toBe(403);
      }
    });

    test('GET /api/reports/crm — only CRM_MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/reports/crm', {
        allowed: ['SUPER_ADMIN', 'CRM_MANAGER'],
        blocked: ['IT_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });
  });

  // ── 4. IT + CRM cross-domain separation ─────────────────────────────────────
  test.describe('Cross-domain separation', () => {

    test('IT_AGENT cannot access any CRM route', async () => {
      for (const path of ['/api/crm/contacts', '/api/crm/leads', '/api/crm/deals', '/api/quotes']) {
        const res = await GET(ctx, tokens.IT_AGENT, path);
        expect(res.status(), `IT_AGENT blocked from ${path}`).toBe(403);
      }
    });

    test('SALES_REP cannot access IT-only routes (assets, SLA)', async () => {
      for (const path of ['/api/itdesk/assets', '/api/itdesk/sla-policies']) {
        const res = await GET(ctx, tokens.SALES_REP, path);
        expect(res.status(), `SALES_REP blocked from ${path}`).toBe(403);
      }
    });

    test('IT_MANAGER cannot access CRM analytics', async () => {
      const res = await GET(ctx, tokens.IT_MANAGER, '/api/analytics/crm');
      expect(res.status(), 'IT_MANAGER CRM analytics should be 403').toBe(403);
    });

    test('CRM_MANAGER cannot access IT analytics', async () => {
      const res = await GET(ctx, tokens.CRM_MANAGER, '/api/analytics/tickets');
      expect(res.status(), 'CRM_MANAGER IT analytics should be 403').toBe(403);
    });

    test('SUPER_ADMIN can access both IT and CRM analytics', async () => {
      const itRes = await GET(ctx, tokens.SUPER_ADMIN, '/api/analytics/tickets');
      expect(itRes.status(), 'SUPER_ADMIN IT analytics').toBeLessThan(400);

      const crmRes = await GET(ctx, tokens.SUPER_ADMIN, '/api/analytics/crm');
      expect(crmRes.status(), 'SUPER_ADMIN CRM analytics').toBeLessThan(400);
    });
  });

  // ── 5. Manager-only routes ───────────────────────────────────────────────────
  test.describe('Manager-only routes', () => {

    test('GET /api/analytics/overview — only MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/analytics/overview', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'],
        blocked: ['IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/audit-logs — only MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/audit-logs', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'],
        blocked: ['IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/workflows — only MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/workflows', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'],
        blocked: ['IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/custom-fields — all can read, only MANAGERS can write', async () => {
      // All staff can read field definitions
      for (const role of ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await GET(ctx, tokens[role], '/api/custom-fields');
        expect(res.status(), `${role} read custom-fields`).toBeLessThan(400);
      }

      // Only managers can create field definitions
      for (const role of ['IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await POST(ctx, tokens[role], '/api/custom-fields', {
          name: 'rbac_test_field', label: 'RBAC Field', entityType: 'ticket', fieldType: 'text',
        });
        expect(res.status(), `${role} create custom-field should be 403`).toBe(403);
      }
    });
  });

  // ── 6. Admin-only routes (SUPER_ADMIN) ──────────────────────────────────────
  test.describe('Admin-only routes', () => {

    test('GET /api/api-keys — only SUPER_ADMIN allowed', async () => {
      await assertAccess(ctx, tokens, '/api/api-keys', {
        allowed: ['SUPER_ADMIN'],
        blocked: ['IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/billing/subscription — only SUPER_ADMIN allowed', async () => {
      await assertAccess(ctx, tokens, '/api/billing/subscription', {
        allowed: ['SUPER_ADMIN'],
        blocked: ['IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/branding — all can read, only SUPER_ADMIN can write', async () => {
      // All authenticated users can read branding
      for (const role of ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await GET(ctx, tokens[role], '/api/branding');
        expect(res.status(), `${role} read branding`).toBeLessThan(400);
      }

      // Non-admins cannot write branding
      for (const role of ['IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await POST(ctx, tokens[role], '/api/branding', { primaryColor: '#000' });
        expect(res.status(), `${role} write branding should be 403`).toBe(403);
      }
    });
  });

  // ── 7. IT-manager-only integrations ─────────────────────────────────────────
  test.describe('IT integration routes (IT_MANAGERS only)', () => {

    test('GET /api/slack/config — only IT_MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/slack/config', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER'],
        blocked: ['CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/teams — only IT_MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/teams', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER'],
        blocked: ['CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/portal-users — only IT_MANAGERS allowed', async () => {
      await assertAccess(ctx, tokens, '/api/portal-users', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER'],
        blocked: ['CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/csat — only IT_MANAGERS can view CSAT responses', async () => {
      await assertAccess(ctx, tokens, '/api/csat', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER'],
        blocked: ['CRM_MANAGER', 'IT_AGENT', 'SALES_REP'],
      });
    });

    test('GET /api/change-requests — only IT_STAFF allowed', async () => {
      await assertAccess(ctx, tokens, '/api/change-requests', {
        allowed: ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'],
        blocked: ['CRM_MANAGER', 'SALES_REP'],
      });
    });

    test('POST /api/change-requests/:id/approve — only IT_MANAGERS allowed', async () => {
      // IT_AGENT cannot approve
      const res = await POST(ctx, tokens.IT_AGENT, '/api/change-requests/non-existent/approve');
      expect(res.status(), 'IT_AGENT approve CR should be 403').toBe(403);
    });
  });

  // ── 8. All-staff accessible routes ───────────────────────────────────────────
  test.describe('All-staff accessible routes', () => {

    test('GET /api/search — all staff can search', async () => {
      for (const role of ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await GET(ctx, tokens[role], '/api/search?q=test');
        expect(res.status(), `${role} search`).toBeLessThan(400);
      }
    });

    test('GET /api/notifications — all staff can view notifications', async () => {
      for (const role of ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await GET(ctx, tokens[role], '/api/notifications');
        expect(res.status(), `${role} notifications`).toBeLessThan(400);
      }
    });

    test('GET /api/users — all authenticated users can list users (for assignment dropdowns)', async () => {
      for (const role of ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] as Role[]) {
        const res = await GET(ctx, tokens[role], '/api/users');
        expect(res.status(), `${role} list users`).toBeLessThan(400);
      }
    });
  });

  // ── 9. SUPER_ADMIN has universal access ──────────────────────────────────────
  test.describe('SUPER_ADMIN universal access', () => {
    const allRoutes = [
      '/api/itdesk/tickets',
      '/api/itdesk/categories',
      '/api/itdesk/articles',
      '/api/itdesk/assets',
      '/api/itdesk/sla-policies',
      '/api/crm/contacts',
      '/api/crm/leads',
      '/api/crm/deals',
      '/api/crm/accounts',
      '/api/quotes',
      '/api/campaigns',
      '/api/workflows',
      '/api/api-keys',
      '/api/branding',
      '/api/audit-logs',
      '/api/analytics/overview',
      '/api/analytics/tickets',
      '/api/analytics/crm',
      '/api/reports/tickets',
      '/api/reports/crm',
      '/api/portal-users',
      '/api/billing/subscription',
      '/api/csat',
      '/api/change-requests',
      '/api/slack/config',
      '/api/teams',
      '/api/custom-fields',
    ];

    for (const path of allRoutes) {
      test(`SUPER_ADMIN can GET ${path}`, async () => {
        const res = await GET(ctx, tokens.SUPER_ADMIN, path);
        expect(res.status(), `SUPER_ADMIN ${path}`).not.toBe(403);
        expect(res.status(), `SUPER_ADMIN ${path}`).not.toBe(401);
      });
    }
  });
});
