/**
 * Unit tests for the people/task/approval/permission/RAG platform.
 *
 * These cover the pure logic — the parts where a bug is silent rather than
 * loud. A broken controller throws a 500 you notice in a minute; a broken
 * `scopedWhere()` returns *more rows than it should* and nobody notices until
 * a customer sees another team's salaries.
 *
 * No database, no server, no generated Prisma client required — tests/unit/
 * stub-prisma.js removes that dependency, so this runs on a fresh clone.
 *
 *     npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scopeFor,
  can,
  scopedWhere,
  canAccessRecord,
  redact,
  canWriteField,
  stripUnwritableFields,
  isKnownPermission,
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  SENSITIVE_FIELD_DEFAULTS,
  type PermCtx,
  type Scope,
  type Access,
} from '../../src/utils/permissions';

import { evaluateCondition, conditionsMatch } from '../../src/utils/approvals';
import { chunkText, estimateTokens } from '../../src/utils/rag';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ctx(overrides: Partial<PermCtx> = {}): PermCtx {
  return {
    userId: 'user-self',
    orgId: 'org-1',
    role: 'SALES_REP',
    roleKey: 'SALES_REP',
    roleId: 'role-1',
    employeeId: 'emp-self',
    departmentId: 'dept-sales',
    reportEmployeeIds: ['emp-report-1', 'emp-report-2'],
    reportUserIds: ['user-report-1'],
    teamEmployeeIds: ['emp-peer-1'],
    grants: new Map<string, Scope>(),
    fieldRules: new Map<string, Access>(),
    ...overrides,
  };
}

function withGrants(pairs: Array<[string, Scope]>, overrides: Partial<PermCtx> = {}): PermCtx {
  return ctx({ grants: new Map(pairs), ...overrides });
}

// ═══ Permission catalog ══════════════════════════════════════════════════════

test('catalog: every permission key is unique', () => {
  const keys = PERMISSION_CATALOG.map(p => p.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate permission keys found');
});

test('catalog: keys follow module.resource.action', () => {
  for (const p of PERMISSION_CATALOG) {
    assert.equal(p.key, `${p.module}.${p.resource}.${p.action}`, `malformed key: ${p.key}`);
  }
});

test('catalog: HR money and identity permissions are flagged sensitive', () => {
  const sensitive = ['hr.payslip.read', 'hr.salary.read', 'hr.employee.read', 'hr.document.read'];
  for (const key of sensitive) {
    const p = PERMISSION_CATALOG.find(x => x.key === key);
    assert.ok(p, `${key} missing from catalog`);
    assert.equal(p!.isSensitive, true, `${key} should be marked sensitive`);
  }
});

test('catalog: isKnownPermission distinguishes real keys from typos', () => {
  assert.equal(isKnownPermission('crm.deal.read'), true);
  assert.equal(isKnownPermission('crm.deal.raed'), false);
});

test('roles: every system role has a unique key and a legacy mapping', () => {
  const keys = SYSTEM_ROLES.map(r => r.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const r of SYSTEM_ROLES) assert.ok(r.legacyRole, `${r.key} has no legacyRole`);
});

test('roles: the three personas missing from the audit now exist', () => {
  for (const key of ['HR_MANAGER', 'FINANCE', 'EXECUTIVE']) {
    assert.ok(SYSTEM_ROLES.some(r => r.key === key), `${key} role missing`);
  }
});

// ═══ scopeFor / can ══════════════════════════════════════════════════════════

test('scopeFor: a granted permission returns its scope', () => {
  const c = withGrants([['crm.deal.read', 'TEAM']]);
  assert.equal(scopeFor(c, 'crm.deal.read'), 'TEAM');
  assert.equal(can(c, 'crm.deal.read'), true);
});

test('scopeFor: a catalogued permission with no grant is NONE', () => {
  const c = withGrants([]);
  assert.equal(scopeFor(c, 'crm.deal.read'), 'NONE');
  assert.equal(can(c, 'crm.deal.read'), false);
});

test('scopeFor: an UNKNOWN key defaults to ALL — the default-open contract', () => {
  // This is the rule that stops an unmigrated controller from suddenly
  // 403-ing because someone forgot to add its key to the catalog.
  const c = withGrants([]);
  assert.equal(scopeFor(c, 'some.future.permission'), 'ALL');
  assert.equal(can(c, 'some.future.permission'), true);
});

// ═══ scopedWhere ═════════════════════════════════════════════════════════════

test('scopedWhere: ALL adds no filter', () => {
  const c = withGrants([['crm.deal.read', 'ALL']]);
  assert.deepEqual(scopedWhere(c, 'deal', 'crm.deal.read'), {});
});

test('scopedWhere: NONE returns an unsatisfiable filter, not an empty one', () => {
  // The dangerous failure mode is returning {} for NONE, which would mean
  // "no filter" = every record. Assert it fails closed.
  const c = withGrants([]);
  const where = scopedWhere(c, 'deal', 'crm.deal.read');
  assert.notDeepEqual(where, {}, 'NONE must not produce an unfiltered query');
  assert.deepEqual(where, { id: '__no_access__' });
});

test('scopedWhere: OWN filters to the caller', () => {
  const c = withGrants([['crm.deal.read', 'OWN']]);
  assert.deepEqual(scopedWhere(c, 'deal', 'crm.deal.read'), { assignedTo: { in: ['user-self'] } });
});

test('scopedWhere: TEAM includes the caller and their reports', () => {
  const c = withGrants([['crm.deal.read', 'TEAM']]);
  const where = scopedWhere(c, 'deal', 'crm.deal.read') as any;
  assert.deepEqual(where, { assignedTo: { in: ['user-self', 'user-report-1'] } });
});

test('scopedWhere: DEPARTMENT uses the department column when the resource has one', () => {
  const c = withGrants([['hr.employee.read', 'DEPARTMENT']]);
  const where = scopedWhere(c, 'employee', 'hr.employee.read') as any;
  assert.deepEqual(where, { departmentId: 'dept-sales' });
});

test('scopedWhere: DEPARTMENT falls back to the reporting tree, never to ALL', () => {
  // `deal` has no department column. The wrong behaviour would be to widen to
  // every deal; the right one is to narrow to who the caller manages.
  const c = withGrants([['crm.deal.read', 'DEPARTMENT']]);
  const where = scopedWhere(c, 'deal', 'crm.deal.read') as any;
  assert.notDeepEqual(where, {}, 'DEPARTMENT must not silently widen to ALL');
  assert.deepEqual(where, { assignedTo: { in: ['user-self', 'user-report-1'] } });
});

test('scopedWhere: task matches on either the user or the employee assignee', () => {
  const c = withGrants([['core.task.read', 'OWN']]);
  const where = scopedWhere(c, 'task', 'core.task.read') as any;
  assert.deepEqual(where, {
    OR: [{ assigneeUserId: { in: ['user-self'] } }, { assigneeEmployeeId: { in: ['emp-self'] } }],
  });
});

test('scopedWhere: a caller with no employee record still resolves OWN', () => {
  const c = withGrants([['core.task.read', 'OWN']], { employeeId: null });
  const where = scopedWhere(c, 'task', 'core.task.read') as any;
  assert.deepEqual(where, { assigneeUserId: { in: ['user-self'] } });
});

test('scopedWhere: an unknown resource does not fail closed on a granted permission', () => {
  // A resource with no SCOPE_SHAPE has no ownership concept, so there is
  // nothing to narrow by — returning {} is correct here, unlike for NONE.
  const c = withGrants([['core.report.read', 'OWN']]);
  assert.deepEqual(scopedWhere(c, 'report', 'core.report.read'), {});
});

// ═══ canAccessRecord ═════════════════════════════════════════════════════════

test('canAccessRecord: OWN accepts my record and rejects a colleague’s', () => {
  const c = withGrants([['crm.deal.read', 'OWN']]);
  assert.equal(canAccessRecord(c, 'deal', 'crm.deal.read', { assignedTo: 'user-self' }), true);
  assert.equal(canAccessRecord(c, 'deal', 'crm.deal.read', { assignedTo: 'user-other' }), false);
});

test('canAccessRecord: TEAM accepts a direct report’s record', () => {
  const c = withGrants([['crm.deal.read', 'TEAM']]);
  assert.equal(canAccessRecord(c, 'deal', 'crm.deal.read', { assignedTo: 'user-report-1' }), true);
  assert.equal(canAccessRecord(c, 'deal', 'crm.deal.read', { assignedTo: 'user-stranger' }), false);
});

test('canAccessRecord: TEAM accepts a team peer by employee id', () => {
  const c = withGrants([['core.task.read', 'TEAM']]);
  assert.equal(
    canAccessRecord(c, 'task', 'core.task.read', { assigneeUserId: null, assigneeEmployeeId: 'emp-peer-1' }),
    true
  );
});

test('canAccessRecord: NONE rejects even a record the caller owns', () => {
  const c = withGrants([]);
  assert.equal(canAccessRecord(c, 'deal', 'crm.deal.read', { assignedTo: 'user-self' }), false);
});

test('canAccessRecord: ALL accepts anything', () => {
  const c = withGrants([['crm.deal.read', 'ALL']]);
  assert.equal(canAccessRecord(c, 'deal', 'crm.deal.read', { assignedTo: 'anyone' }), true);
});

// ═══ redact ══════════════════════════════════════════════════════════════════

test('redact: no field rules leaves the record untouched', () => {
  const c = ctx();
  const row = { id: 'e1', displayName: 'Priya', bankAccountNumber: '123456789012' };
  assert.deepEqual(redact(c, 'employee', row), row);
});

test('redact: MASKED keeps the last 4 characters only', () => {
  const c = ctx({ fieldRules: new Map<string, Access>([['employee.bankAccountNumber', 'MASKED']]) });
  const out = redact(c, 'employee', { id: 'e1', bankAccountNumber: '123456789012' }) as any;
  assert.equal(out.bankAccountNumber, '••••••9012');
  assert.equal(out.id, 'e1', 'unrelated fields must survive');
});

test('redact: HIDDEN removes the key entirely', () => {
  const c = ctx({ fieldRules: new Map<string, Access>([['employee.taxId', 'HIDDEN']]) });
  const out = redact(c, 'employee', { id: 'e1', taxId: 'ABCDE1234F' }) as any;
  assert.equal('taxId' in out, false, 'HIDDEN must delete the key, not blank it');
});

test('redact: a masked number becomes null rather than a misleading string', () => {
  const c = ctx({ fieldRules: new Map<string, Access>([['payslip.netPay', 'MASKED']]) });
  const out = redact(c, 'payslip', { id: 'p1', netPay: 84200 }) as any;
  assert.equal(out.netPay, null);
});

test('redact: applies to every element of an array', () => {
  const c = ctx({ fieldRules: new Map<string, Access>([['employee.nationalId', 'HIDDEN']]) });
  const out = redact(c, 'employee', [
    { id: 'a', nationalId: 'X1' },
    { id: 'b', nationalId: 'X2' },
  ]) as any[];
  assert.equal(out.length, 2);
  assert.ok(out.every(r => !('nationalId' in r)));
});

test('redact: rules are scoped per resource and do not bleed across', () => {
  const c = ctx({ fieldRules: new Map<string, Access>([['employee.bankName', 'HIDDEN']]) });
  const deal = redact(c, 'deal', { id: 'd1', bankName: 'not-really-a-bank-field' }) as any;
  assert.equal(deal.bankName, 'not-really-a-bank-field', 'an employee rule must not affect deals');
});

test('redact: READ and WRITE rules pass the value through unchanged', () => {
  const c = ctx({ fieldRules: new Map<string, Access>([['employee.phone', 'READ']]) });
  const out = redact(c, 'employee', { phone: '+919876543210' }) as any;
  assert.equal(out.phone, '+919876543210');
});

test('redact: collects the names of what it removed, for the AI audit trail', () => {
  const c = ctx({
    fieldRules: new Map<string, Access>([
      ['employee.taxId', 'HIDDEN'],
      ['employee.bankAccountNumber', 'MASKED'],
    ]),
  });
  const collected = new Set<string>();
  redact(c, 'employee', { taxId: 'X', bankAccountNumber: '999988887777', displayName: 'A' }, collected);
  assert.deepEqual([...collected].sort(), ['employee.bankAccountNumber', 'employee.taxId']);
});

test('redact: null and undefined pass through without throwing', () => {
  const c = ctx({ fieldRules: new Map<string, Access>([['employee.taxId', 'HIDDEN']]) });
  assert.equal(redact(c, 'employee', null), null);
  assert.equal(redact(c, 'employee', undefined), undefined);
});

// ═══ Field writes ════════════════════════════════════════════════════════════

test('canWriteField: no rule means writable', () => {
  assert.equal(canWriteField(ctx(), 'employee', 'designation'), true);
});

test('canWriteField: only an explicit WRITE rule permits writing', () => {
  const c = ctx({
    fieldRules: new Map<string, Access>([
      ['employee.bankAccountNumber', 'MASKED'],
      ['employee.designation', 'READ'],
      ['employee.phone', 'WRITE'],
    ]),
  });
  assert.equal(canWriteField(c, 'employee', 'bankAccountNumber'), false);
  assert.equal(canWriteField(c, 'employee', 'designation'), false);
  assert.equal(canWriteField(c, 'employee', 'phone'), true);
});

test('stripUnwritableFields: a masked value echoed back cannot overwrite the real one', () => {
  // The attack this prevents: read a record (bank number comes back masked),
  // change one other field, PATCH the whole object back — and write '••••9012'
  // over the real account number.
  const c = ctx({ fieldRules: new Map<string, Access>([['employee.bankAccountNumber', 'MASKED']]) });
  const out = stripUnwritableFields(c, 'employee', {
    designation: 'Senior Engineer',
    bankAccountNumber: '••••••9012',
  });
  assert.deepEqual(out, { designation: 'Senior Engineer' });
});

test('sensitive defaults cover the columns that would actually hurt', () => {
  for (const f of ['bankAccountNumber', 'taxId', 'nationalId', 'socialSecurityId']) {
    assert.ok(SENSITIVE_FIELD_DEFAULTS.employee.includes(f), `employee.${f} not masked by default`);
  }
  assert.ok(SENSITIVE_FIELD_DEFAULTS.payslip.includes('netPay'));
  assert.ok(SENSITIVE_FIELD_DEFAULTS.salary.includes('basic'));
});

// ═══ Approval conditions ═════════════════════════════════════════════════════

test('evaluateCondition: comparison operators', () => {
  assert.equal(evaluateCondition(10, 'gt', 5), true);
  assert.equal(evaluateCondition(5, 'gt', 10), false);
  assert.equal(evaluateCondition(5, 'gte', 5), true);
  assert.equal(evaluateCondition(4, 'lt', 5), true);
  assert.equal(evaluateCondition(5, 'lte', 5), true);
});

test('evaluateCondition: eq compares as strings so "5" and 5 match', () => {
  assert.equal(evaluateCondition('5', 'eq', 5), true);
  assert.equal(evaluateCondition(5, 'neq', 6), true);
});

test('evaluateCondition: contains is case-insensitive', () => {
  assert.equal(evaluateCondition('Critical Incident', 'contains', 'critical'), true);
  assert.equal(evaluateCondition('Routine', 'contains', 'critical'), false);
});

test('evaluateCondition: in checks membership', () => {
  assert.equal(evaluateCondition('HIGH', 'in', ['HIGH', 'URGENT']), true);
  assert.equal(evaluateCondition('LOW', 'in', ['HIGH', 'URGENT']), false);
  assert.equal(evaluateCondition('HIGH', 'in', 'not-an-array' as any), false);
});

test('conditionsMatch: absent or empty conditions always match', () => {
  assert.equal(conditionsMatch(null, { amount: 1 }), true);
  assert.equal(conditionsMatch([], { amount: 1 }), true);
  assert.equal(conditionsMatch(undefined, {}), true);
});

test('conditionsMatch: every condition must hold (AND, not OR)', () => {
  const facts = { amount: 75000, days: 3, department: 'Sales' };
  assert.equal(
    conditionsMatch([{ field: 'amount', op: 'gt', value: 50000 }, { field: 'days', op: 'lt', value: 5 }], facts),
    true
  );
  assert.equal(
    conditionsMatch([{ field: 'amount', op: 'gt', value: 50000 }, { field: 'days', op: 'gt', value: 5 }], facts),
    false
  );
});

test('conditionsMatch: the leave-policy example from the backfill behaves', () => {
  // "HR also approves above 5 days"
  const rule = [{ field: 'days', op: 'gt' as const, value: 5 }];
  assert.equal(conditionsMatch(rule, { days: 7 }), true, '7 days should require HR');
  assert.equal(conditionsMatch(rule, { days: 3 }), false, '3 days should skip HR');
  assert.equal(conditionsMatch(rule, { days: 5 }), false, 'exactly 5 days should skip HR');
});

test('conditionsMatch: a missing fact does not accidentally satisfy the rule', () => {
  assert.equal(conditionsMatch([{ field: 'amount', op: 'gt', value: 100 }], {}), false);
});

// ═══ RAG chunking ════════════════════════════════════════════════════════════

test('chunkText: empty input yields no chunks', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('chunkText: short text stays a single chunk', () => {
  const chunks = chunkText('A short leave policy paragraph.');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].index, 0);
});

test('chunkText: long text splits into several chunks with sequential indexes', () => {
  const para = 'Employees accrue leave monthly. '.repeat(40);
  const text = Array.from({ length: 8 }, () => para).join('\n\n');
  const chunks = chunkText(text, 200);
  assert.ok(chunks.length > 1, 'expected multiple chunks');
  chunks.forEach((c, i) => assert.equal(c.index, i, 'chunk indexes must be sequential'));
});

test('chunkText: consecutive chunks overlap, so a fact on a boundary stays findable', () => {
  const para = 'Annual leave is eighteen days per calendar year. '.repeat(30);
  const chunks = chunkText([para, para, para].join('\n\n'), 150);
  assert.ok(chunks.length >= 2);
  const tail = chunks[0].content.slice(-30);
  assert.ok(chunks[1].content.includes(tail.slice(0, 15)), 'expected overlap between adjacent chunks');
});

test('chunkText: markdown headings are captured for citation', () => {
  const text = '# Leave Policy\n\nSome intro text here.\n\n## Section 4.2\n\nEmployees receive 18 days.';
  const chunks = chunkText(text, 40);
  assert.ok(chunks.some(c => c.heading === 'Leave Policy' || c.heading === 'Section 4.2'), 'no heading captured');
});

test('chunkText: an oversized single paragraph is split, not emitted whole', () => {
  const giant = 'This is one very long sentence without a blank line. '.repeat(200);
  const chunks = chunkText(giant, 100);
  assert.ok(chunks.length > 1, 'a paragraph longer than the window must be split');
  const maxChars = 100 * 4;
  // Allow modest slack for sentence-boundary splitting.
  assert.ok(chunks.every(c => c.content.length <= maxChars * 1.5), 'a chunk far exceeded the window');
});

test('estimateTokens: grows with length and is never negative', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('hello world') > 0);
  assert.ok(estimateTokens('a'.repeat(400)) > estimateTokens('a'.repeat(40)));
});

// ═══ User ↔ Employee provisioning ════════════════════════════════════════════
//
// The concern these guard against: splitting Employee out of User must not turn
// "add a new starter" into two jobs. Provisioning is what keeps the split
// invisible, so its edge cases matter more than most.

import { __testables as provisioning } from '../../src/utils/employeeProvisioning';

test('splitName: a single name has no surname rather than a duplicated one', () => {
  assert.deepEqual(provisioning.splitName('Prince'), { firstName: 'Prince', lastName: null });
});

test('splitName: two parts split cleanly', () => {
  assert.deepEqual(provisioning.splitName('Carla Chen'), { firstName: 'Carla', lastName: 'Chen' });
});

test('splitName: three or more parts keep everything after the first as surname', () => {
  assert.deepEqual(provisioning.splitName('Jane Q. Doe'), { firstName: 'Jane', lastName: 'Q. Doe' });
});

test('splitName: extra whitespace does not create empty parts', () => {
  assert.deepEqual(provisioning.splitName('  Ravi   Kumar  '), { firstName: 'Ravi', lastName: 'Kumar' });
});

test('splitName: an empty name yields a placeholder rather than throwing', () => {
  // A blank display name must not be able to break user creation — the whole
  // provisioning path is non-throwing by design.
  assert.deepEqual(provisioning.splitName(''), { firstName: 'Unnamed', lastName: null });
  assert.deepEqual(provisioning.splitName('   '), { firstName: 'Unnamed', lastName: null });
});

test('nextCodeFrom: the first employee in an org is EMP-0001', () => {
  assert.equal(provisioning.nextCodeFrom(undefined), 'EMP-0001');
  assert.equal(provisioning.nextCodeFrom(null), 'EMP-0001');
});

test('nextCodeFrom: codes increment and stay zero-padded', () => {
  assert.equal(provisioning.nextCodeFrom('EMP-0001'), 'EMP-0002');
  assert.equal(provisioning.nextCodeFrom('EMP-0099'), 'EMP-0100');
  assert.equal(provisioning.nextCodeFrom('EMP-0999'), 'EMP-1000');
});

test('nextCodeFrom: a non-numeric code does not produce EMP-NaN', () => {
  // An org that imported its own codes must not corrupt the generated sequence.
  assert.equal(provisioning.nextCodeFrom('EMP-CONTRACTOR'), 'EMP-0001');
});
