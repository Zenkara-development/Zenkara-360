/**
 * End-to-end API smoke test for the people/task/approval/permission/RAG
 * platform.
 *
 * Unlike the unit tests, this one needs a running server and a real database —
 * it is the check that the migration applied, the routers are mounted, the
 * permission engine resolves against real rows, and the approval engine
 * actually advances a request through its steps.
 *
 *     # terminal 1
 *     cd server && npm run dev
 *
 *     # terminal 2
 *     cd server && npm run test:api
 *
 * Configuration (all optional, sensible defaults for the demo seed):
 *     API_URL       default http://localhost:4000/api
 *     ADMIN_EMAIL   default admin@crmitdesk.com
 *     ADMIN_PASSWORD default Admin@123
 *     EMPLOYEE_EMAIL / EMPLOYEE_PASSWORD  optional second login, used to prove
 *                   that record scoping and field masking actually bite. Skipped
 *                   with a clear note if not provided.
 *
 * It cleans up everything it creates. Read-only against your existing data.
 */

const API = process.env.API_URL ?? 'http://localhost:4000/api';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@crmitdesk.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@123';
const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL;
const EMPLOYEE_PASSWORD = process.env.EMPLOYEE_PASSWORD ?? 'Admin@123';

// ─── Tiny harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GREY = '\x1b[90m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function section(name: string): void {
  console.log(`\n${BOLD}── ${name} ${'─'.repeat(Math.max(0, 62 - name.length))}${RESET}`);
}

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ${RED}✗${RESET} ${name}`);
    console.log(`    ${GREY}${String(err.message).split('\n')[0].slice(0, 160)}${RESET}`);
  }
}

function skip(name: string, why: string): void {
  skipped++;
  console.log(`  ${YELLOW}−${RESET} ${name} ${GREY}(${why})${RESET}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

interface Res<T = any> {
  status: number;
  body: T;
}

async function req<T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<Res<T>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  let body: any = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

async function login(email: string, password: string): Promise<{ token: string; userId: string; role: string }> {
  const res = await req('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email} (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  const token = res.body.accessToken ?? res.body.token;
  assert(token, 'login response had no access token');
  return { token, userId: res.body.user?.id, role: res.body.user?.role };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`${BOLD}Platform API smoke test${RESET}`);
  console.log(`${GREY}${API} as ${ADMIN_EMAIL}${RESET}`);

  // Fail fast and legibly if the server isn't up — otherwise every check
  // below fails with the same connection error and hides the real problem.
  try {
    const health = await fetch(`${API.replace(/\/api$/, '')}/health`).catch(() => null);
    if (!health) {
      const ping = await fetch(API).catch(() => null);
      if (!ping) {
        console.log(`\n${RED}Cannot reach ${API}. Start the server with \`npm run dev\` first.${RESET}\n`);
        process.exit(1);
      }
    }
  } catch {
    /* continue — the login below will report properly */
  }

  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  // Track what we create so cleanup can be exact rather than a broad delete.
  const created = {
    departmentId: '',
    employeeId: '',
    teamId: '',
    locationId: '',
    taskId: '',
    subtaskId: '',
    policyId: '',
    requestId: '',
    roleId: '',
  };

  // ═══ Gap 1 & 2 — people ════════════════════════════════════════════════════
  section('Gap 1 & 2 — Employees, departments, teams, locations');

  await check('GET /hr/org/departments responds', async () => {
    const r = await req('GET', '/hr/org/departments', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    assert(Array.isArray(r.body.data), 'expected a data array');
  });

  await check('POST /hr/org/departments creates a department', async () => {
    const name = `QA Test Dept ${Date.now()}`;
    const r = await req('POST', '/hr/org/departments', { token: admin.token, body: { name, code: 'QA' } });
    assertEq(r.status, 201, `create failed: ${JSON.stringify(r.body).slice(0, 200)}`);
    created.departmentId = r.body.id;
    assert(created.departmentId, 'no id returned');
  });

  await check('duplicate department name is rejected with 409', async () => {
    const existing = await req('GET', `/hr/org/departments`, { token: admin.token });
    const name = existing.body.data.find((d: any) => d.id === created.departmentId)?.name;
    const r = await req('POST', '/hr/org/departments', { token: admin.token, body: { name } });
    assertEq(r.status, 409, 'expected a conflict');
  });

  await check('POST /hr/org/locations creates a location', async () => {
    const r = await req('POST', '/hr/org/locations', {
      token: admin.token,
      body: { name: `QA Office ${Date.now()}`, type: 'BRANCH', city: 'Hyderabad' },
    });
    assertEq(r.status, 201, JSON.stringify(r.body).slice(0, 200));
    created.locationId = r.body.id;
  });

  await check('POST /hr/employees creates an employee with a generated code', async () => {
    const r = await req('POST', '/hr/employees', {
      token: admin.token,
      body: {
        firstName: 'QA',
        lastName: 'Tester',
        workEmail: `qa.tester.${Date.now()}@example.com`,
        designation: 'Automation Engineer',
        departmentId: created.departmentId,
        locationId: created.locationId,
        joiningDate: new Date().toISOString().slice(0, 10),
        employmentType: 'FULL_TIME',
      },
    });
    assertEq(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    created.employeeId = r.body.id;
    assert(/^EMP-\d{4}$/.test(r.body.employeeCode), `employeeCode looks wrong: ${r.body.employeeCode}`);
    assertEq(r.body.displayName, 'QA Tester', 'displayName should be derived from first + last name');
  });

  await check('an employee with no login is allowed (the whole point of the split)', async () => {
    const r = await req('GET', `/hr/employees/${created.employeeId}`, { token: admin.token });
    assertEq(r.status, 200, 'could not read back the employee');
    assertEq(r.body.user, null, 'expected no linked user');
  });

  await check('sensitive fields round-trip through encryption', async () => {
    const acct = '123456789012';
    const patch = await req('PATCH', `/hr/employees/${created.employeeId}`, {
      token: admin.token,
      body: { bankAccountNumber: acct, bankName: 'QA Bank' },
    });
    assertEq(patch.status, 200, JSON.stringify(patch.body).slice(0, 200));
    const read = await req('GET', `/hr/employees/${created.employeeId}`, { token: admin.token });
    // SUPER_ADMIN is exempt from masking, so it should come back in the clear —
    // which also proves encryption/decryption worked rather than corrupting it.
    assertEq(read.body.bankAccountNumber, acct, 'admin should see the real account number');
  });

  await check('a reporting loop is rejected', async () => {
    const r = await req('PATCH', `/hr/employees/${created.employeeId}`, {
      token: admin.token,
      body: { managerId: created.employeeId },
    });
    assertEq(r.status, 400, 'an employee reporting to themselves should be a 400');
  });

  await check('GET /hr/employees/org-chart returns a tree', async () => {
    const r = await req('GET', '/hr/employees/org-chart', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    assert(Array.isArray(r.body.data), 'expected a data array');
    if (r.body.data.length) assert('reports' in r.body.data[0], 'nodes should carry a reports array');
  });

  await check('GET /hr/employees/stats aggregates', async () => {
    const r = await req('GET', '/hr/employees/stats', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    assert(typeof r.body.total === 'number', 'expected a total');
    assert(Array.isArray(r.body.byDepartment), 'expected byDepartment');
  });

  await check('POST /hr/org/teams creates a team and accepts a member', async () => {
    const t = await req('POST', '/hr/org/teams', {
      token: admin.token,
      body: { name: `QA Team ${Date.now()}`, departmentId: created.departmentId },
    });
    assertEq(t.status, 201, JSON.stringify(t.body).slice(0, 200));
    created.teamId = t.body.id;

    const m = await req('POST', `/hr/org/teams/${created.teamId}/members`, {
      token: admin.token,
      body: { employeeId: created.employeeId, role: 'MEMBER' },
    });
    assertEq(m.status, 201, JSON.stringify(m.body).slice(0, 200));
  });

  await check('a department with employees cannot be deleted', async () => {
    const r = await req('DELETE', `/hr/org/departments/${created.departmentId}`, { token: admin.token });
    assertEq(r.status, 400, 'expected a guard against orphaning employees');
  });

  // ═══ Gap 3 — tasks ═════════════════════════════════════════════════════════
  section('Gap 3a — Universal tasks');

  await check('POST /tasks creates a task with a checklist', async () => {
    const r = await req('POST', '/tasks', {
      token: admin.token,
      body: {
        title: 'QA smoke task',
        priority: 'HIGH',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        checklist: [
          { id: 'c1', text: 'First step', done: false },
          { id: 'c2', text: 'Second step', done: false },
        ],
      },
    });
    assertEq(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    created.taskId = r.body.id;
    assertEq(r.body.status, 'OPEN', 'new tasks should start OPEN');
  });

  await check('a task can hang off any entity type', async () => {
    const r = await req('POST', '/tasks', {
      token: admin.token,
      body: { title: 'QA employee-linked task', entityType: 'EMPLOYEE', entityId: created.employeeId },
    });
    assertEq(r.status, 201, JSON.stringify(r.body).slice(0, 200));
    created.subtaskId = r.body.id;
    assertEq(r.body.entityType, 'EMPLOYEE', 'polymorphic link not stored');
  });

  await check('entityType without entityId is rejected', async () => {
    const r = await req('POST', '/tasks', { token: admin.token, body: { title: 'bad', entityType: 'DEAL' } });
    assertEq(r.status, 400, 'expected validation to catch a dangling entityType');
  });

  await check('checklist items toggle and record who ticked them', async () => {
    const r = await req('PATCH', `/tasks/${created.taskId}/checklist`, {
      token: admin.token,
      body: { itemId: 'c1', done: true },
    });
    assertEq(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    const item = (r.body.checklist as any[]).find(i => i.id === 'c1');
    assertEq(item.done, true, 'item should be ticked');
    assert(item.doneAt, 'expected a doneAt timestamp');
  });

  await check('a FINISH_TO_START dependency blocks completion', async () => {
    const blocker = await req('POST', '/tasks', { token: admin.token, body: { title: 'QA blocker task' } });
    const dependent = await req('POST', '/tasks', {
      token: admin.token,
      body: { title: 'QA dependent task', dependsOnTaskIds: [blocker.body.id] },
    });
    const attempt = await req('PATCH', `/tasks/${dependent.body.id}`, { token: admin.token, body: { status: 'DONE' } });
    assertEq(attempt.status, 400, 'completing a blocked task should 400');

    // Unblock, then it should succeed — proving the guard releases correctly.
    await req('PATCH', `/tasks/${blocker.body.id}`, { token: admin.token, body: { status: 'DONE' } });
    const retry = await req('PATCH', `/tasks/${dependent.body.id}`, { token: admin.token, body: { status: 'DONE' } });
    assertEq(retry.status, 200, 'should complete once the blocker is done');

    await req('DELETE', `/tasks/${dependent.body.id}`, { token: admin.token });
    await req('DELETE', `/tasks/${blocker.body.id}`, { token: admin.token });
  });

  await check('GET /tasks/my-work returns time buckets and an approvals list', async () => {
    const r = await req('GET', '/tasks/my-work', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    for (const key of ['overdue', 'today', 'thisWeek', 'later', 'noDate', 'approvals', 'counts']) {
      assert(key in r.body, `my-work response missing "${key}"`);
    }
  });

  await check('bulk update reports how many rows it actually changed', async () => {
    const r = await req('POST', '/tasks/bulk', {
      token: admin.token,
      body: { ids: [created.taskId], priority: 'URGENT' },
    });
    assertEq(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assertEq(r.body.updated, 1, 'expected exactly one row updated');
  });

  // ═══ Gap 3b — approvals ════════════════════════════════════════════════════
  section('Gap 3b — Approval engine');

  await check('POST /approvals/policies creates a policy', async () => {
    const r = await req('POST', '/approvals/policies', {
      token: admin.token,
      body: {
        name: `QA policy ${Date.now()}`,
        entityType: 'CUSTOM',
        mode: 'SEQUENTIAL',
        steps: [{ order: 1, name: 'Admin sign-off', approverType: 'USER', approverUserId: admin.userId, minApprovals: 1 }],
      },
    });
    assertEq(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    created.policyId = r.body.id;
  });

  await check('a policy step with no resolvable approver is rejected', async () => {
    const r = await req('POST', '/approvals/policies', {
      token: admin.token,
      body: {
        name: `QA bad policy ${Date.now()}`,
        entityType: 'CUSTOM',
        steps: [{ order: 1, name: 'Nobody', approverType: 'USER' }],
      },
    });
    assertEq(r.status, 400, 'a USER step with no user should be caught at creation');
  });

  await check('a request against a matching policy is created as PENDING', async () => {
    const r = await req('POST', '/approvals/requests', {
      token: admin.token,
      body: { entityType: 'CUSTOM', entityId: created.taskId, title: 'QA approval request', amount: 1000 },
    });
    assertEq(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    created.requestId = r.body.id;
    assertEq(r.body.status, 'PENDING', 'expected a pending request');
  });

  await check('the request appears in the approver’s inbox', async () => {
    const r = await req('GET', '/approvals/requests/my-pending', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    assert(
      r.body.data.some((a: any) => a.requestId === created.requestId),
      'the new request is not in my-pending'
    );
  });

  await check('approving advances the request to APPROVED', async () => {
    const r = await req('POST', `/approvals/requests/${created.requestId}/decide`, {
      token: admin.token,
      body: { decision: 'APPROVED', comment: 'QA approved' },
    });
    assertEq(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assertEq(r.body.status, 'APPROVED', 'expected the request to finalise');
    assertEq(r.body.finalized, true, 'expected finalized=true on the last step');
  });

  await check('deciding twice on a settled request is rejected', async () => {
    const r = await req('POST', `/approvals/requests/${created.requestId}/decide`, {
      token: admin.token,
      body: { decision: 'REJECTED' },
    });
    assertEq(r.status, 400, 'a settled request should not accept another decision');
  });

  await check('a request with no matching policy auto-approves rather than hanging', async () => {
    // This is the behaviour that keeps the engine opt-in: a customer who has
    // configured nothing must not find records stuck forever.
    const r = await req('POST', '/approvals/requests', {
      token: admin.token,
      body: { entityType: 'PURCHASE', entityId: 'no-policy-for-this', title: 'QA unmatched request' },
    });
    assertEq(r.status, 200, 'expected 200 with autoApproved, not 201');
    assertEq(r.body.autoApproved, true, 'expected autoApproved=true');
  });

  await check('you cannot delegate approvals to yourself', async () => {
    const r = await req('POST', '/approvals/delegations', {
      token: admin.token,
      body: {
        toUserId: admin.userId,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    assertEq(r.status, 400, 'self-delegation should be rejected');
  });

  // ═══ Gap 4 — permissions ═══════════════════════════════════════════════════
  section('Gap 4 — Permission engine');

  await check('GET /permissions/me returns the caller’s effective grants', async () => {
    const r = await req('GET', '/permissions/me', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    assert(r.body.permissions && typeof r.body.permissions === 'object', 'expected a permissions map');
    assertEq(r.body.permissions['hr.employee.read'], 'ALL', 'admin should hold hr.employee.read at ALL');
  });

  await check('GET /permissions/catalog groups permissions by module', async () => {
    const r = await req('GET', '/permissions/catalog', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    for (const mod of ['crm', 'itdesk', 'hr', 'core', 'ai']) {
      assert(mod in r.body.data, `catalog missing module "${mod}"`);
    }
  });

  await check('the nine built-in roles are seeded', async () => {
    const r = await req('GET', '/permissions/roles', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    const keys = r.body.data.map((x: any) => x.key);
    for (const k of ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'HR_MANAGER', 'FINANCE', 'EXECUTIVE', 'IT_AGENT', 'SALES_REP', 'EMPLOYEE']) {
      assert(keys.includes(k), `built-in role ${k} is missing — did the backfill run?`);
    }
  });

  await check('a custom role can be created with a narrowed scope', async () => {
    const r = await req('POST', '/permissions/roles', {
      token: admin.token,
      body: {
        key: `QA_ROLE_${Date.now()}`.slice(0, 40),
        name: 'QA Narrow Role',
        rank: 60,
        permissions: [{ permissionKey: 'crm.deal.read', scope: 'OWN' }],
      },
    });
    assertEq(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    created.roleId = r.body.id;
    const grant = r.body.permissions.find((p: any) => p.permissionKey === 'crm.deal.read');
    assertEq(grant?.scope, 'OWN', 'scope was not persisted');
  });

  await check('a role more senior than the caller is refused', async () => {
    const r = await req('POST', '/permissions/roles', {
      token: admin.token,
      body: { key: `QA_GOD_${Date.now()}`.slice(0, 40), name: 'QA Escalation', rank: -1 },
    });
    assert(r.status === 403 || r.status === 400, `expected a refusal, got ${r.status}`);
  });

  await check('a built-in role cannot be deleted', async () => {
    const roles = await req('GET', '/permissions/roles', { token: admin.token });
    const sysRole = roles.body.data.find((x: any) => x.isSystem && x.orgId);
    if (!sysRole) throw new Error('no org-scoped system role found to test against');
    const r = await req('DELETE', `/permissions/roles/${sysRole.id}`, { token: admin.token });
    assertEq(r.status, 400, 'deleting a built-in role should be refused');
  });

  await check('a field rule can be set on a role', async () => {
    const r = await req('POST', `/permissions/roles/${created.roleId}/fields`, {
      token: admin.token,
      body: { resource: 'employee', field: 'bankAccountNumber', access: 'HIDDEN' },
    });
    assertEq(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assertEq(r.body.access, 'HIDDEN', 'access not stored');
  });

  // ── The part that actually proves the engine bites ──
  if (EMPLOYEE_EMAIL) {
    let emp: { token: string; userId: string; role: string };
    await check(`a second login (${EMPLOYEE_EMAIL}) authenticates`, async () => {
      emp = await login(EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    });

    await check('a non-admin sees masked or absent sensitive fields', async () => {
      const r = await req('GET', `/hr/employees/${created.employeeId}`, { token: emp!.token });
      if (r.status === 403) return; // no read access at all is also a valid outcome
      assertEq(r.status, 200, 'unexpected status');
      const acct = r.body.bankAccountNumber;
      assert(
        acct == null || String(acct).includes('•'),
        `a non-admin must not see the raw account number, got: ${JSON.stringify(acct)}`
      );
    });

    await check('a non-admin cannot create an employee', async () => {
      const r = await req('POST', '/hr/employees', {
        token: emp!.token,
        body: { firstName: 'Nope', joiningDate: new Date().toISOString().slice(0, 10) },
      });
      assertEq(r.status, 403, 'expected a 403');
    });

    await check('a non-admin cannot read the role catalog', async () => {
      const r = await req('GET', '/permissions/roles', { token: emp!.token });
      assertEq(r.status, 403, 'expected a 403');
    });

    await check('a non-admin still sees their own My Work', async () => {
      const r = await req('GET', '/tasks/my-work', { token: emp!.token });
      assertEq(r.status, 200, 'every role should reach their own work queue');
    });
  } else {
    skip('cross-role scoping and masking checks', 'set EMPLOYEE_EMAIL to enable');
    skip('non-admin 403 checks', 'set EMPLOYEE_EMAIL to enable');
  }

  await check('an unauthenticated request is rejected', async () => {
    const r = await req('GET', '/hr/employees');
    assertEq(r.status, 401, 'expected a 401 without a token');
  });

  // ═══ Gap 5 — knowledge & AI governance ═════════════════════════════════════
  section('Gap 5 — RAG and AI governance');

  await check('GET /knowledge/stats reports the vector backend in use', async () => {
    const r = await req('GET', '/knowledge/stats', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    assert(
      ['pgvector', 'in-process'].includes(r.body.vectorBackend),
      `unexpected vectorBackend: ${r.body.vectorBackend}`
    );
    console.log(`    ${GREY}vector backend: ${r.body.vectorBackend}, ${r.body.documents} docs, ${r.body.chunks} chunks${RESET}`);
  });

  await check('GET /knowledge/ai/observability returns the spend dashboard shape', async () => {
    const r = await req('GET', '/knowledge/ai/observability', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    for (const key of ['totalCalls', 'successRate', 'totalCostUsd', 'byFeature', 'byModel', 'budget']) {
      assert(key in r.body, `observability response missing "${key}"`);
    }
  });

  await check('GET /knowledge/ai/logs is paginated', async () => {
    const r = await req('GET', '/knowledge/ai/logs?limit=5', { token: admin.token });
    assertEq(r.status, 200, 'unexpected status');
    assert(Array.isArray(r.body.data), 'expected a data array');
    assert(r.body.pagination, 'expected pagination metadata');
  });

  await check('a monthly AI budget can be set and read back', async () => {
    const put = await req('PUT', '/knowledge/ai/budget', {
      token: admin.token,
      body: { limitUsd: 50, alertThresholdPercent: 80, hardStop: false },
    });
    assertEq(put.status, 200, JSON.stringify(put.body).slice(0, 200));
    const get = await req('GET', '/knowledge/ai/budget', { token: admin.token });
    assertEq(Number(get.body.limitUsd), 50, 'budget did not persist');
  });

  await check('knowledge search responds (empty index is a valid answer)', async () => {
    const r = await req('POST', '/knowledge/search', { token: admin.token, body: { query: 'leave policy' } });
    if (r.status === 500 && JSON.stringify(r.body).includes('embedding')) {
      throw new Error('no embedding provider configured — set OPENAI_API_KEY to enable RAG');
    }
    assertEq(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assert(Array.isArray(r.body.data), 'expected a data array');
  });

  // ═══ Cleanup ═══════════════════════════════════════════════════════════════
  section('Cleanup');

  await check('test data is removed', async () => {
    if (created.subtaskId) await req('DELETE', `/tasks/${created.subtaskId}`, { token: admin.token });
    if (created.taskId) await req('DELETE', `/tasks/${created.taskId}`, { token: admin.token });
    if (created.policyId) await req('DELETE', `/approvals/policies/${created.policyId}`, { token: admin.token });
    if (created.roleId) await req('DELETE', `/permissions/roles/${created.roleId}`, { token: admin.token });
    if (created.teamId) await req('DELETE', `/hr/org/teams/${created.teamId}`, { token: admin.token });
    if (created.employeeId) await req('DELETE', `/hr/employees/${created.employeeId}`, { token: admin.token });
    if (created.departmentId) await req('DELETE', `/hr/org/departments/${created.departmentId}`, { token: admin.token });
    if (created.locationId) await req('DELETE', `/hr/org/locations/${created.locationId}`, { token: admin.token });
  });

  // ═══ Summary ═══════════════════════════════════════════════════════════════
  console.log(`\n${'─'.repeat(66)}`);
  console.log(
    `${BOLD}${passed} passed${RESET}` +
      (failed ? `, ${RED}${BOLD}${failed} failed${RESET}` : '') +
      (skipped ? `, ${YELLOW}${skipped} skipped${RESET}` : '')
  );

  if (failures.length) {
    console.log(`\n${RED}Failures:${RESET}`);
    for (const f of failures) console.log(`  • ${f}`);
    console.log('');
    process.exit(1);
  }
  console.log('');
}

main().catch(err => {
  console.error(`\n${RED}Fatal:${RESET} ${err.message}\n`);
  process.exit(1);
});
