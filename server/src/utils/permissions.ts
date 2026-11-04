/**
 * Permission engine — record-level scope + field-level access.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Before this file, authorization was two things: `requireRole(...)` on the
 * route, and `orgId` in the where-clause. That's a *module* gate, not a data
 * gate. Any SALES_REP who could reach GET /crm/deals could read every deal in
 * the org, and `salaryStructure` was protected only by the fact that its
 * controller lived behind a different URL. Once AI can query broadly (see
 * utils/aiGateway.ts), "the route checked the role" stops being an acceptable
 * answer, because the model doesn't go through routes.
 *
 * ── Rollout contract: additive and default-open ───────────────────────────
 * This module must not change the behavior of a single existing endpoint on
 * the day it lands. Three rules enforce that:
 *
 *   1. `User.roleId` is optional. A user with no Role row resolves through
 *      LEGACY_ROLE_GRANTS below, which encodes exactly what the six UserRole
 *      enum values could already do — with scope ALL, matching today's
 *      "org-wide read" reality.
 *   2. An unknown permission key resolves to ALL, never to NONE. A controller
 *      that hasn't been migrated yet keeps working even if someone deletes
 *      its catalog row.
 *   3. Field redaction only strips fields that have an explicit
 *      FieldPermission row saying HIDDEN/MASKED. No row = field passes
 *      through untouched.
 *
 * Tightening therefore becomes a *data* change an admin makes in the UI, not
 * a deploy. The one place we deliberately ship tighter-than-before defaults
 * is the sensitive HR/payroll field set (SENSITIVE_FIELD_DEFAULTS), because
 * shipping bank account numbers to every role that can list employees would
 * be introducing a leak, not preserving one — those columns are brand new in
 * this same change, so there is no prior behavior to preserve.
 */
import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Scope = 'NONE' | 'OWN' | 'TEAM' | 'DEPARTMENT' | 'ALL';
export type Access = 'HIDDEN' | 'MASKED' | 'READ' | 'WRITE';

export interface PermCtx {
  userId: string;
  orgId: string;
  /** The UserRole enum value carried on the JWT. */
  role: string;
  /** Resolved Role.key when the user has a Role row; else the legacy role. */
  roleKey: string;
  roleId: string | null;
  /** Employee.id, when this login is linked to an employee record. */
  employeeId: string | null;
  departmentId: string | null;
  /** Employee ids this user manages, directly or transitively. */
  reportEmployeeIds: string[];
  /** User ids of those same reports (only those who have logins). */
  reportUserIds: string[];
  teamEmployeeIds: string[];
  grants: Map<string, Scope>;
  fieldRules: Map<string, Access>;
}

// ─── Permission catalog ───────────────────────────────────────────────────────
//
// Seeded into the Permission table by seedPermissionCatalog(). Kept in code so
// a fresh deploy has a complete catalog without a manual data step, and so a
// typo in a controller's permission key is greppable against one list.

export interface PermissionDef {
  key: string;
  module: string;
  resource: string;
  action: string;
  label: string;
  isSensitive?: boolean;
}

function crud(module: string, resource: string, label: string, sensitive = false): PermissionDef[] {
  return (['read', 'create', 'update', 'delete'] as const).map(action => ({
    key: `${module}.${resource}.${action}`,
    module,
    resource,
    action,
    label: `${action[0].toUpperCase()}${action.slice(1)} ${label}`,
    isSensitive: sensitive,
  }));
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  ...crud('crm', 'lead', 'leads'),
  ...crud('crm', 'contact', 'contacts'),
  ...crud('crm', 'account', 'accounts'),
  ...crud('crm', 'deal', 'deals'),
  ...crud('crm', 'quote', 'quotes'),
  ...crud('crm', 'invoice', 'invoices'),
  ...crud('crm', 'campaign', 'campaigns'),
  ...crud('crm', 'activity', 'activities'),
  ...crud('itdesk', 'ticket', 'tickets'),
  ...crud('itdesk', 'asset', 'assets'),
  ...crud('itdesk', 'article', 'knowledge articles'),
  ...crud('itdesk', 'change', 'change requests'),
  ...crud('itdesk', 'category', 'ticket categories'),
  ...crud('itdesk', 'sla', 'SLA policies'),
  ...crud('hr', 'employee', 'employee records', true),
  ...crud('hr', 'department', 'departments'),
  ...crud('hr', 'team', 'teams'),
  ...crud('hr', 'location', 'locations'),
  ...crud('hr', 'attendance', 'attendance'),
  ...crud('hr', 'leave', 'leave requests'),
  ...crud('hr', 'payslip', 'payslips', true),
  ...crud('hr', 'salary', 'salary structures', true),
  ...crud('hr', 'document', 'employee documents', true),
  ...crud('core', 'task', 'tasks'),
  ...crud('core', 'approval', 'approvals'),
  ...crud('core', 'user', 'users'),
  ...crud('core', 'role', 'roles and permissions'),
  ...crud('core', 'workflow', 'workflows'),
  ...crud('core', 'report', 'reports'),
  ...crud('ai', 'knowledge', 'AI knowledge base'),
  { key: 'ai.assistant.use', module: 'ai', resource: 'assistant', action: 'use', label: 'Use the AI assistant' },
  { key: 'ai.action.execute', module: 'ai', resource: 'action', action: 'execute', label: 'Execute AI actions' },
  { key: 'ai.governance.manage', module: 'ai', resource: 'governance', action: 'manage', label: 'Manage AI governance', isSensitive: true },
  { key: 'core.audit.read', module: 'core', resource: 'audit', action: 'read', label: 'Read audit logs', isSensitive: true },
  { key: 'core.org.manage', module: 'core', resource: 'org', action: 'manage', label: 'Manage organization settings' },
];

const CATALOG_KEYS = new Set(PERMISSION_CATALOG.map(p => p.key));

/** True when `key` is a real catalog entry — used to fail loudly in dev on typos. */
export function isKnownPermission(key: string): boolean {
  return CATALOG_KEYS.has(key);
}

// ─── Legacy role → grants ─────────────────────────────────────────────────────
//
// The exact reach each UserRole enum value had before this file existed,
// determined by reading every requireRole(...) call site. Scope is ALL
// throughout, because org-wide visibility *was* the prior behavior — this
// table preserves it rather than endorsing it. Customers narrow it afterwards
// by editing the seeded Role rows.

type LegacyGrant = { modules: string[]; scope?: Scope; except?: string[] };

const LEGACY_ROLE_GRANTS: Record<string, LegacyGrant> = {
  SUPER_ADMIN: { modules: ['*'] },
  IT_MANAGER: { modules: ['itdesk', 'core', 'ai', 'hr'], except: ['hr.payslip.delete', 'hr.salary.delete'] },
  CRM_MANAGER: { modules: ['crm', 'core', 'ai', 'hr'], except: ['hr.payslip.delete', 'hr.salary.delete'] },
  IT_AGENT: {
    modules: ['itdesk'],
    except: ['itdesk.sla.delete', 'itdesk.category.delete'],
  },
  SALES_REP: { modules: ['crm'], except: ['crm.account.delete'] },
  EMPLOYEE: { modules: [] },
  PLATFORM_ADMIN: { modules: ['*'] },
};

/** Permissions every authenticated user holds regardless of role, scoped to their own records. */
const BASELINE_SELF_GRANTS: Array<[string, Scope]> = [
  ['hr.attendance.read', 'OWN'],
  ['hr.attendance.create', 'OWN'],
  ['hr.leave.read', 'OWN'],
  ['hr.leave.create', 'OWN'],
  ['hr.payslip.read', 'OWN'],
  ['hr.employee.read', 'OWN'],
  ['hr.document.read', 'OWN'],
  ['core.task.read', 'OWN'],
  ['core.task.create', 'OWN'],
  ['core.task.update', 'OWN'],
  ['core.approval.read', 'OWN'],
  ['core.approval.create', 'OWN'],
  ['itdesk.ticket.create', 'OWN'],
  ['itdesk.ticket.read', 'OWN'],
  ['itdesk.article.read', 'ALL'],
  ['ai.assistant.use', 'OWN'],
];

function legacyGrantsFor(role: string): Map<string, Scope> {
  const out = new Map<string, Scope>();
  for (const [key, scope] of BASELINE_SELF_GRANTS) out.set(key, scope);

  const def = LEGACY_ROLE_GRANTS[role];
  if (!def) return out;

  for (const p of PERMISSION_CATALOG) {
    const inModule = def.modules.includes('*') || def.modules.includes(p.module);
    if (!inModule) continue;
    if (def.except?.includes(p.key)) continue;
    out.set(p.key, def.scope ?? 'ALL');
  }
  return out;
}

// ─── Sensitive field defaults ────────────────────────────────────────────────
//
// Applied to every role EXCEPT SUPER_ADMIN when the built-in roles are seeded.
// These columns did not exist before this change, so masking them by default
// isn't a regression — it's the correct starting position for data we are
// introducing.

export const SENSITIVE_FIELD_DEFAULTS: Record<string, string[]> = {
  employee: [
    'bankAccountName',
    'bankAccountNumber',
    'bankName',
    'bankIfsc',
    'taxId',
    'nationalId',
    'socialSecurityId',
    'dateOfBirth',
    'personalEmail',
  ],
  payslip: ['basic', 'hra', 'allowances', 'grossPay', 'netPay', 'pf', 'professionalTax', 'otherDeductions', 'totalDeductions'],
  salary: ['basic', 'hra', 'allowances', 'pfPercent', 'professionalTax', 'otherDeductions'],
};

/** Roles that legitimately see HR-sensitive fields in full. */
const SENSITIVE_FIELD_EXEMPT_ROLES = new Set(['SUPER_ADMIN', 'HR_MANAGER', 'PLATFORM_ADMIN']);

// ─── Context resolution ──────────────────────────────────────────────────────

const CTX_TTL_MS = 60_000;
const ctxCache = new Map<string, { ctx: PermCtx; expires: number }>();

/** Drops a user's cached grants. Call after changing their role or manager. */
export function invalidatePermCtx(userId: string): void {
  ctxCache.delete(userId);
}

export function invalidateAllPermCtx(): void {
  ctxCache.clear();
}

/**
 * Builds the full permission picture for one request. Cached for 60s because
 * it costs 3 queries and is hit on effectively every scoped endpoint; a role
 * change takes at most a minute to propagate, and invalidatePermCtx() makes
 * it immediate where we control the write.
 */
export async function getPermCtx(user: { id: string; orgId: string; role: string }): Promise<PermCtx> {
  const cached = ctxCache.get(user.id);
  if (cached && Date.now() < cached.expires) return cached.ctx;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      roleId: true,
      roleRef: {
        select: {
          id: true,
          key: true,
          permissions: { select: { permissionKey: true, scope: true } },
          fieldPermissions: { select: { resource: true, field: true, access: true } },
        },
      },
      employee: { select: { id: true, departmentId: true } },
    },
  });

  const grants = new Map<string, Scope>();
  const fieldRules = new Map<string, Access>();
  let roleKey = user.role;

  if (dbUser?.roleRef) {
    roleKey = dbUser.roleRef.key;
    for (const rp of dbUser.roleRef.permissions) grants.set(rp.permissionKey, rp.scope as Scope);
    for (const fp of dbUser.roleRef.fieldPermissions) {
      fieldRules.set(`${fp.resource}.${fp.field}`, fp.access as Access);
    }
    // Baseline self-grants are unconditional — a custom role that forgets to
    // grant "read my own payslip" shouldn't lock a person out of their own data.
    for (const [key, scope] of BASELINE_SELF_GRANTS) {
      if (!grants.has(key)) grants.set(key, scope);
    }
  } else {
    for (const [k, v] of legacyGrantsFor(user.role)) grants.set(k, v);
    if (!SENSITIVE_FIELD_EXEMPT_ROLES.has(user.role)) {
      for (const [resource, fields] of Object.entries(SENSITIVE_FIELD_DEFAULTS)) {
        for (const f of fields) fieldRules.set(`${resource}.${f}`, 'MASKED');
      }
    }
  }

  const employeeId = dbUser?.employee?.id ?? null;
  const departmentId = dbUser?.employee?.departmentId ?? null;

  const { reportEmployeeIds, reportUserIds } = employeeId
    ? await resolveReports(employeeId, user.orgId)
    : { reportEmployeeIds: [], reportUserIds: [] };

  const teamEmployeeIds = employeeId ? await resolveTeamPeers(employeeId) : [];

  const ctx: PermCtx = {
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
    roleKey,
    roleId: dbUser?.roleId ?? null,
    employeeId,
    departmentId,
    reportEmployeeIds,
    reportUserIds,
    teamEmployeeIds,
    grants,
    fieldRules,
  };

  ctxCache.set(user.id, { ctx, expires: Date.now() + CTX_TTL_MS });
  return ctx;
}

/**
 * Walks the reporting tree downwards. Bounded to 6 levels — deeper than any
 * real org chart we'd expect, and a hard stop against a cycle introduced by
 * bad data (A manages B manages A) turning this into an infinite loop.
 */
async function resolveReports(
  employeeId: string,
  orgId: string
): Promise<{ reportEmployeeIds: string[]; reportUserIds: string[] }> {
  const all = new Set<string>();
  let frontier = [employeeId];

  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const rows: Array<{ id: string }> = await prisma.employee.findMany({
      where: { orgId, managerId: { in: frontier } },
      select: { id: true },
    });
    frontier = [];
    for (const r of rows) {
      if (!all.has(r.id)) {
        all.add(r.id);
        frontier.push(r.id);
      }
    }
  }

  if (!all.size) return { reportEmployeeIds: [], reportUserIds: [] };

  const withUsers: Array<{ userId: string | null }> = await prisma.employee.findMany({
    where: { id: { in: [...all] }, userId: { not: null } },
    select: { userId: true },
  });

  return {
    reportEmployeeIds: [...all],
    reportUserIds: withUsers.map(u => u.userId).filter((v): v is string => !!v),
  };
}

async function resolveTeamPeers(employeeId: string): Promise<string[]> {
  const memberships: Array<{ teamId: string }> = await prisma.teamMember.findMany({
    where: { employeeId },
    select: { teamId: true },
  });
  if (!memberships.length) return [];

  const peers: Array<{ employeeId: string }> = await prisma.teamMember.findMany({
    where: { teamId: { in: memberships.map(m => m.teamId) } },
    select: { employeeId: true },
  });
  return [...new Set(peers.map(p => p.employeeId))];
}

// ─── Checks ───────────────────────────────────────────────────────────────────

/**
 * The scope this context has on a permission.
 *
 * Returns ALL for keys that aren't in the catalog — see the "default-open"
 * contract at the top. An unmigrated controller must not start 403-ing
 * because someone forgot to add its key here.
 */
export function scopeFor(ctx: PermCtx, permissionKey: string): Scope {
  if (!CATALOG_KEYS.has(permissionKey)) return 'ALL';
  return ctx.grants.get(permissionKey) ?? 'NONE';
}

export function can(ctx: PermCtx, permissionKey: string): boolean {
  return scopeFor(ctx, permissionKey) !== 'NONE';
}

/** Throws 403 unless the context holds the permission at any scope. */
export function assertCan(ctx: PermCtx, permissionKey: string): void {
  if (!can(ctx, permissionKey)) {
    throw new AppError(403, 'Insufficient permissions');
  }
}

// ─── Record-level scoping ─────────────────────────────────────────────────────

/**
 * Describes how a resource expresses "who owns this record", so scopedWhere()
 * can build the right filter without every controller re-deriving it.
 *
 *  - ownerField:      column holding the owning User id
 *  - employeeField:   column holding the owning Employee id
 *  - departmentPath:  Prisma relation path to a departmentId, for DEPARTMENT
 */
export interface ScopeShape {
  ownerField?: string;
  employeeField?: string;
  departmentField?: string;
  departmentPath?: Record<string, unknown>;
}

export const SCOPE_SHAPES: Record<string, ScopeShape> = {
  lead: { ownerField: 'assignedTo' },
  deal: { ownerField: 'assignedTo' },
  contact: { ownerField: 'ownerId' },
  account: { ownerField: 'ownerId' },
  quote: { ownerField: 'createdBy' },
  ticket: { ownerField: 'assignedTo' },
  asset: { ownerField: 'assignedTo' },
  task: { ownerField: 'assigneeUserId', employeeField: 'assigneeEmployeeId' },
  approval: { ownerField: 'requestedBy' },
  employee: { ownerField: 'userId', employeeField: 'id', departmentField: 'departmentId' },
  attendance: { ownerField: 'userId' },
  leave: { ownerField: 'userId' },
  payslip: { ownerField: 'userId' },
  salary: { ownerField: 'userId' },
  document: { employeeField: 'employeeId' },
};

/**
 * The where-fragment implementing a scope for one resource.
 *
 * Always AND this with `{ orgId }` at the call site — this function is about
 * *which records within the tenant*, never about tenancy itself. Keeping the
 * two separate means a bug here can never widen access across orgs.
 *
 * Returns `{}` for ALL (no extra filter) and a deliberately unsatisfiable
 * filter for NONE, so a caller that forgets to check `can()` first still
 * returns nothing rather than everything.
 */
export function scopedWhere(ctx: PermCtx, resource: string, permissionKey: string): Record<string, unknown> {
  const scope = scopeFor(ctx, permissionKey);
  const shape = SCOPE_SHAPES[resource];

  if (scope === 'ALL') return {};
  if (scope === 'NONE') return { id: '__no_access__' };
  if (!shape) return {};

  const ors: Array<Record<string, unknown>> = [];

  const pushOwner = (ids: string[]) => {
    if (shape.ownerField && ids.length) ors.push({ [shape.ownerField]: { in: ids } });
  };
  const pushEmployee = (ids: string[]) => {
    if (shape.employeeField && ids.length) ors.push({ [shape.employeeField]: { in: ids } });
  };

  if (scope === 'OWN') {
    pushOwner([ctx.userId]);
    if (ctx.employeeId) pushEmployee([ctx.employeeId]);
  }

  if (scope === 'TEAM') {
    pushOwner([ctx.userId, ...ctx.reportUserIds]);
    const empIds = [ctx.employeeId, ...ctx.reportEmployeeIds, ...ctx.teamEmployeeIds].filter(
      (v): v is string => !!v
    );
    pushEmployee(empIds);
  }

  if (scope === 'DEPARTMENT') {
    if (shape.departmentField && ctx.departmentId) {
      ors.push({ [shape.departmentField]: ctx.departmentId });
    } else if (shape.departmentPath && ctx.departmentId) {
      ors.push(shape.departmentPath);
    } else {
      // Resource has no department column — fall back to the reporting tree
      // rather than silently widening to ALL.
      pushOwner([ctx.userId, ...ctx.reportUserIds]);
      pushEmployee([ctx.employeeId, ...ctx.reportEmployeeIds].filter((v): v is string => !!v));
    }
  }

  if (!ors.length) return { id: '__no_access__' };
  return ors.length === 1 ? ors[0] : { OR: ors };
}

/** True when this context may act on one already-loaded record. */
export function canAccessRecord(
  ctx: PermCtx,
  resource: string,
  permissionKey: string,
  record: Record<string, any>
): boolean {
  const scope = scopeFor(ctx, permissionKey);
  if (scope === 'ALL') return true;
  if (scope === 'NONE') return false;

  const shape = SCOPE_SHAPES[resource];
  if (!shape) return true;

  const owner = shape.ownerField ? record[shape.ownerField] : undefined;
  const emp = shape.employeeField ? record[shape.employeeField] : undefined;

  if (scope === 'OWN') return owner === ctx.userId || (!!emp && emp === ctx.employeeId);

  if (scope === 'TEAM') {
    return (
      owner === ctx.userId ||
      ctx.reportUserIds.includes(owner) ||
      (!!emp && (emp === ctx.employeeId || ctx.reportEmployeeIds.includes(emp) || ctx.teamEmployeeIds.includes(emp)))
    );
  }

  if (scope === 'DEPARTMENT') {
    if (shape.departmentField && ctx.departmentId) return record[shape.departmentField] === ctx.departmentId;
    return owner === ctx.userId || ctx.reportUserIds.includes(owner);
  }

  return false;
}

// ─── Field-level redaction ────────────────────────────────────────────────────

const MASK = '••••••';

function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') return null;
  if (typeof value === 'string' && value.length > 4) return `${MASK}${value.slice(-4)}`;
  return MASK;
}

/**
 * Strips or masks fields this context may not see.
 *
 * This is the function that has to be applied on *every* egress path, not just
 * REST responses — search results, CSV exports, and above all the payloads
 * handed to an LLM. A field-level rule that only covers the REST layer is not
 * a field-level rule; it's a suggestion. utils/aiGateway.ts calls it before
 * any prompt is built, and records what it removed on AiInteractionLog
 * .redactedFields so the omission is auditable.
 *
 * `collect` receives the redacted field names so callers can log them.
 */
export function redact<T>(
  ctx: PermCtx,
  resource: string,
  data: T,
  collect?: Set<string>
): T {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(item => redact(ctx, resource, item, collect)) as unknown as T;
  }

  if (typeof data !== 'object') return data;

  const rules: Array<[string, Access]> = [];
  const prefix = `${resource}.`;
  for (const [k, v] of ctx.fieldRules) {
    if (k.startsWith(prefix)) rules.push([k.slice(prefix.length), v]);
  }
  if (!rules.length) return data;

  const out: Record<string, any> = { ...(data as Record<string, any>) };
  for (const [field, access] of rules) {
    if (!(field in out)) continue;
    if (access === 'HIDDEN') {
      delete out[field];
      collect?.add(`${resource}.${field}`);
    } else if (access === 'MASKED') {
      out[field] = maskValue(out[field]);
      collect?.add(`${resource}.${field}`);
    }
  }
  return out as unknown as T;
}

/** True when the context may write this specific field. */
export function canWriteField(ctx: PermCtx, resource: string, field: string): boolean {
  const rule = ctx.fieldRules.get(`${resource}.${field}`);
  if (!rule) return true;
  return rule === 'WRITE';
}

/** Drops fields the context can't write, so a masked value can't be echoed back as an update. */
export function stripUnwritableFields<T extends Record<string, any>>(
  ctx: PermCtx,
  resource: string,
  input: T
): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (canWriteField(ctx, resource, k)) out[k] = v;
  }
  return out as T;
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

export const SYSTEM_ROLES: Array<{ key: string; name: string; legacyRole: string; rank: number; description: string }> = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', legacyRole: 'SUPER_ADMIN', rank: 0, description: 'Full access to everything in the organization.' },
  { key: 'IT_MANAGER', name: 'IT Manager', legacyRole: 'IT_MANAGER', rank: 20, description: 'Runs the IT desk: tickets, assets, changes, SLAs.' },
  { key: 'CRM_MANAGER', name: 'Sales Manager', legacyRole: 'CRM_MANAGER', rank: 20, description: 'Runs sales: pipeline, team performance, forecasting.' },
  { key: 'HR_MANAGER', name: 'HR Manager', legacyRole: 'HR_MANAGER', rank: 20, description: 'Runs HR: employees, leave, attendance, payroll, documents.' },
  { key: 'FINANCE', name: 'Finance', legacyRole: 'FINANCE', rank: 30, description: 'Quotes, invoices, payroll cost and expense approvals.' },
  { key: 'EXECUTIVE', name: 'Executive', legacyRole: 'EXECUTIVE', rank: 10, description: 'Read-only visibility across every module, plus business health.' },
  { key: 'IT_AGENT', name: 'IT Technician', legacyRole: 'IT_AGENT', rank: 50, description: 'Works the ticket queue.' },
  { key: 'SALES_REP', name: 'Sales Rep', legacyRole: 'SALES_REP', rank: 50, description: 'Works leads and deals.' },
  { key: 'EMPLOYEE', name: 'Employee', legacyRole: 'EMPLOYEE', rank: 90, description: 'Self-service only: own attendance, leave, payslips and requests.' },
];

/** Grants for the roles that have no UserRole enum equivalent to inherit from. */
const NEW_ROLE_GRANTS: Record<string, Array<[string, Scope]>> = {
  HR_MANAGER: [
    ...PERMISSION_CATALOG.filter(p => p.module === 'hr').map(p => [p.key, 'ALL'] as [string, Scope]),
    ['core.task.read', 'ALL'],
    ['core.task.create', 'ALL'],
    ['core.task.update', 'ALL'],
    ['core.approval.read', 'ALL'],
    ['core.approval.update', 'ALL'],
    ['core.user.read', 'ALL'],
    ['core.report.read', 'ALL'],
    ['ai.assistant.use', 'ALL'],
  ],
  FINANCE: [
    ['crm.quote.read', 'ALL'],
    ['crm.quote.update', 'ALL'],
    ['crm.invoice.read', 'ALL'],
    ['crm.invoice.create', 'ALL'],
    ['crm.invoice.update', 'ALL'],
    ['crm.deal.read', 'ALL'],
    ['crm.account.read', 'ALL'],
    ['hr.payslip.read', 'ALL'],
    ['hr.salary.read', 'ALL'],
    ['core.approval.read', 'ALL'],
    ['core.approval.update', 'ALL'],
    ['core.report.read', 'ALL'],
    ['core.task.read', 'ALL'],
    ['ai.assistant.use', 'ALL'],
  ],
  EXECUTIVE: [
    ...PERMISSION_CATALOG.filter(p => p.action === 'read' && !p.isSensitive).map(
      p => [p.key, 'ALL'] as [string, Scope]
    ),
    ['ai.assistant.use', 'ALL'],
  ],
};

/**
 * Idempotently seeds the permission catalog and the built-in roles.
 *
 * Safe to run on every boot: permissions upsert by key, roles upsert by
 * (orgId, key), and role→permission rows are only created when absent, so an
 * admin who has already narrowed SALES_REP from ALL to TEAM does not get it
 * reset on the next deploy. That "never overwrite an existing grant" rule is
 * the whole reason this uses createMany({ skipDuplicates }) rather than a
 * delete-and-recreate.
 */
export async function seedPermissionCatalog(orgId?: string): Promise<void> {
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, resource: p.resource, action: p.action, label: p.label, isSensitive: !!p.isSensitive },
      create: {
        key: p.key,
        module: p.module,
        resource: p.resource,
        action: p.action,
        label: p.label,
        isSensitive: !!p.isSensitive,
      },
    });
  }

  for (const def of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({ where: { orgId: orgId ?? null, key: def.key } });
    const role =
      existing ??
      (await prisma.role.create({
        data: {
          orgId: orgId ?? null,
          key: def.key,
          name: def.name,
          description: def.description,
          isSystem: true,
          legacyRole: def.legacyRole,
          rank: def.rank,
        },
      }));

    const grants =
      NEW_ROLE_GRANTS[def.key] ?? [...legacyGrantsFor(def.legacyRole).entries()];

    if (grants.length) {
      await prisma.rolePermission.createMany({
        data: grants
          .filter(([key]) => CATALOG_KEYS.has(key))
          .map(([permissionKey, scope]) => ({ roleId: role.id, permissionKey, scope })),
        skipDuplicates: true,
      });
    }

    if (!SENSITIVE_FIELD_EXEMPT_ROLES.has(def.key)) {
      const rows = Object.entries(SENSITIVE_FIELD_DEFAULTS).flatMap(([resource, fields]) =>
        fields.map(field => ({ roleId: role.id, orgId: orgId ?? null, resource, field, access: 'MASKED' as const }))
      );
      await prisma.fieldPermission.createMany({ data: rows, skipDuplicates: true });
    }
  }

  invalidateAllPermCtx();
}
