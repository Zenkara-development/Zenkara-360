import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { optionalText, emailField } from '../../../utils/zodHelpers';
import { prisma } from '../../../utils/prisma';
import { parsePagination, paginate } from '../../../utils/pagination';
import { sendMail } from '../../../utils/mailer';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { assertSeatAvailable, isMeteredRole } from '../../../utils/licensing';
import { emailTemplates } from '../../../utils/mailer';
// Keeps User and Employee in step so an admin never adds the same person
// twice — see utils/employeeProvisioning.ts for why the split is invisible
// in day-to-day use.
import { ensureEmployeeForUser, syncUserToEmployee, reconcileOrphans, linkUserToEmployee } from '../../../utils/employeeProvisioning';
import { invalidatePermCtx } from '../../../utils/permissions';

// phone is preprocessed so an empty string (the form's untouched default)
// doesn't get stored as '' — the WhatsApp "assignee" recipient resolver
// treats a falsy phone as "not set", which '' would defeat.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

// `roleId` is the modern input — it points at a Role row, including custom
// roles an admin created. `role` (the enum) is kept because it still drives
// requireRole() on every route and is what the e2e suite and existing API
// clients send. When both arrive, roleId wins and the enum is derived from
// that Role's legacyRole, so the two can never disagree.
const CreateSchema = z.object({
  name: z.string().min(2),
  email: emailField(),
  password: z.string().min(8),
  roleId: z.string().optional(),
  role: z.enum(['SUPER_ADMIN','CRM_MANAGER','SALES_REP','IT_MANAGER','IT_AGENT','EMPLOYEE']).optional(),
  department: z.string().optional(),
  phone: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Set false for service/integration accounts that are not real people. */
  createEmployee: z.boolean().optional(),
});

const InviteSchema = z.object({
  email: emailField(),
  roleId: z.string().optional(),
  role: z.enum(['SUPER_ADMIN','CRM_MANAGER','SALES_REP','IT_MANAGER','IT_AGENT','EMPLOYEE']).default('EMPLOYEE'),
});

// department and phone are String? on User, so a user with neither recorded
// serialises as null — and the edit form sends that null straight back. Plain
// `.optional()` rejects null, which meant editing almost any user failed with
// "Validation error" on fields the admin had never touched. optionalField()
// treats null/'' as "not provided", the same as omitting the key.
const UpdateSchema = z.object({
  name: z.string().min(2).optional(),
  roleId: z.string().nullable().optional(),
  role: z.enum(['SUPER_ADMIN','CRM_MANAGER','SALES_REP','IT_MANAGER','IT_AGENT','EMPLOYEE']).optional(),
  department: optionalText(),
  phone: optionalText(),
  isActive: z.boolean().optional(),
});

type LegacyRole = 'SUPER_ADMIN' | 'CRM_MANAGER' | 'SALES_REP' | 'IT_MANAGER' | 'IT_AGENT' | 'EMPLOYEE';
const LEGACY_ROLES: LegacyRole[] = ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP', 'IT_MANAGER', 'IT_AGENT', 'EMPLOYEE'];

// The admin routes admit SUPER_ADMIN and both managers, so authorization
// inside them has to be rank-aware: without it, an IT_MANAGER could PATCH
// themselves (or anyone) to SUPER_ADMIN, or reset the SUPER_ADMIN's password
// and take over the account. Rank comparisons below enforce two rules:
//   - you can only ASSIGN a role of your own rank or lower (a manager can add
//     another manager, but never mint a SUPER_ADMIN), and
//   - you can only MANAGE (edit/deactivate/reset) users of your rank or lower
//     (a manager can never touch the SUPER_ADMIN's account).
// Custom roles are ranked by their resolved legacyRole, so they can't be used
// as a side door.
const ROLE_RANK: Record<LegacyRole, number> = {
  SUPER_ADMIN: 3,
  CRM_MANAGER: 2,
  IT_MANAGER: 2,
  SALES_REP: 1,
  IT_AGENT: 1,
  EMPLOYEE: 0,
};

function rankOf(role: string): number {
  return ROLE_RANK[role as LegacyRole] ?? 0;
}

/** Caller may not act on a user who outranks them. */
function assertCanManage(callerRole: string, targetRole: string) {
  if (rankOf(targetRole) > rankOf(callerRole)) {
    throw new AppError(403, 'You cannot manage a user with a higher role than your own');
  }
}

/** Caller may not hand out a role above their own rank. */
function assertCanAssign(callerRole: string, newRole: LegacyRole) {
  if (rankOf(newRole) > rankOf(callerRole)) {
    throw new AppError(403, 'You cannot assign a role higher than your own');
  }
}

/**
 * Turns whatever the caller sent into the pair the database needs.
 *
 * Route guards still read the `role` enum, so every user must have one even
 * when they hold a custom role that has no enum equivalent. `Role.legacyRole`
 * is that mapping — the "base access level" chosen when the role was created.
 * A custom role with none set falls back to EMPLOYEE, which is the safe
 * direction to be wrong in: too little route access is visible and fixable,
 * too much is a security hole.
 */
async function resolveRole(
  orgId: string,
  input: { roleId?: string | null; role?: LegacyRole }
): Promise<{ roleId: string | null; role: LegacyRole }> {
  if (input.roleId) {
    const role = await prisma.role.findFirst({
      where: { id: input.roleId, OR: [{ orgId }, { orgId: null }] },
      select: { id: true, legacyRole: true, isActive: true },
    });
    if (!role) throw new AppError(404, 'That role was not found in this organization');
    if (!role.isActive) throw new AppError(400, 'That role is deactivated');

    const legacy = LEGACY_ROLES.includes(role.legacyRole as LegacyRole)
      ? (role.legacyRole as LegacyRole)
      : 'EMPLOYEE';
    return { roleId: role.id, role: legacy };
  }

  const legacy = input.role ?? 'EMPLOYEE';
  // Keep the two columns consistent even when only the enum was sent, so a
  // user created through the API still shows the right role on screen.
  const match = await prisma.role.findFirst({
    where: { legacyRole: legacy, OR: [{ orgId }, { orgId: null }] },
    orderBy: { orgId: 'desc' },
    select: { id: true },
  });
  return { roleId: match?.id ?? null, role: legacy };
}

const select = { id: true, name: true, email: true, role: true, department: true, phone: true, isActive: true, createdAt: true, avatarUrl: true, orgId: true };

// Included on the list so the admin UI can flag a user with no employee record
// — the one state where the User/Employee split leaks into the interface.
const selectWithEmployee = {
  ...select,
  employee: { select: { id: true, employeeCode: true, designation: true } },
  roleRef: { select: { id: true, key: true, name: true } },
};

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search } = req.query as Record<string, string>;
    const pag = parsePagination(req);
    const where: any = { orgId: req.user!.orgId };
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, select: selectWithEmployee, orderBy: { name: 'asc' }, take: pag.limit, skip: pag.skip }),
      prisma.user.count({ where }),
    ]);
    res.json(paginate(users, total, pag));
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = CreateSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError(409, 'Email already registered');

    const resolved = await resolveRole(req.user!.orgId, data);
    assertCanAssign(req.user!.role, resolved.role);
    // Seats are metered against the legacy role, so resolve first.
    await assertSeatAvailable(req.user!.orgId, resolved.role);
    // Destructure password out so it is not spread into the Prisma create call
    // (the User model has `passwordHash`, not `password`)
    const { password, createEmployee, roleId: _roleId, role: _role, ...rest } = data;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { ...rest, ...resolved, passwordHash, orgId: req.user!.orgId },
      select,
    });

    // Adding someone in Administration → Users also makes them an employee, so
    // HR isn't a second data-entry step. Non-throwing: a failure here leaves a
    // user with no employee record, which the Users list flags and
    // POST /admin/users/reconcile-employees can repair.
    const employeeId = await ensureEmployeeForUser(user.id, { skip: createEmployee === false });

    res.status(201).json({ ...user, employeeId });
  } catch (err) { next(err); }
}

/** Send an invite link — user sets their own password */
export async function invite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = InviteSchema.parse(req.body);
    const { role, roleId } = await resolveRole(req.user!.orgId, input);
    assertCanAssign(req.user!.role, role);
    await assertSeatAvailable(req.user!.orgId, role);
    const email = input.email;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const org = await prisma.organization.findUnique({ where: { id: req.user!.orgId }, select: { name: true } });
    const invite = await prisma.inviteToken.create({
      data: { orgId: req.user!.orgId, email, role, roleId, token, expiresAt },
    });

    const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite?token=${token}`;

    // Send invite email (silently skipped if SMTP is not configured)
    await sendMail({
      orgId: req.user!.orgId,
      to: email,
      subject: `You've been invited to join ${org?.name || 'CRM & IT Desk'}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <h2 style="color:#4f46e5">You're invited!</h2>
          <p>You've been invited to join <strong>${org?.name || 'CRM & IT Desk'}</strong> as a <strong>${role.replace(/_/g,' ')}</strong>.</p>
          <p>Click the button below to set up your account. This link expires in 7 days.</p>
          <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Accept Invitation</a>
          <p style="color:#6b7280;font-size:13px">Or copy this link: ${link}</p>
        </div>
      `,
    }).catch(() => {}); // Don't fail the request if email sending fails

    res.status(201).json({ invite, link });
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = UpdateSchema.parse(req.body);
    // Ensure target user is in same org
    const target = await prisma.user.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!target) throw new AppError(404, 'User not found');
    assertCanManage(req.user!.role, target.role);
    // Only re-check the seat limit if this update actually turns someone INTO
    // a billable role (anything but EMPLOYEE) who wasn't one already. A
    // lateral move between two billable roles (e.g. SALES_REP -> CRM_MANAGER)
    // doesn't change the billable headcount, so it must NOT be re-checked
    // here — the target's own existing seat would otherwise cause a false
    // "at limit" block.
    // Only resolve when the caller actually submitted a role change; an
    // untouched role must not be rewritten by a lookup.
    const changingRole = data.roleId !== undefined || data.role !== undefined;
    // Nobody edits their own role — a SUPER_ADMIN accidentally demoting
    // themselves is as locked out as a manager escalating themselves; both
    // directions of that mistake are closed off here.
    if (changingRole && req.params.id === req.user!.id) {
      throw new AppError(403, 'You cannot change your own role');
    }
    const resolved = changingRole ? await resolveRole(req.user!.orgId, data) : null;
    if (resolved) assertCanAssign(req.user!.role, resolved.role);

    if (resolved && resolved.role !== target.role && !isMeteredRole(target.role)) {
      await assertSeatAvailable(req.user!.orgId, resolved.role);
    }

    const { roleId: _rid, role: _r, ...rest } = data;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...rest, ...(resolved ?? {}) },
      select,
    });
    if (resolved) invalidatePermCtx(user.id);

    // Mirror the fields that exist on both records. If this user has no
    // employee (a service account, or one created before HR was set up), the
    // sync is a no-op rather than an error.
    await syncUserToEmployee(user.id, {
      name: data.name,
      phone: data.phone as string | undefined,
      department: data.department,
      isActive: data.isActive,
    });

    res.json(user);
  } catch (err) { next(err); }
}

export async function deactivate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) throw new AppError(400, 'Cannot deactivate yourself');
    const target = await prisma.user.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!target) throw new AppError(404, 'User not found');
    assertCanManage(req.user!.role, target.role);
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    // Losing the login means the person has left. Reactivating deliberately
    // does not un-exit them — rehiring has its own dates and is an HR decision.
    await syncUserToEmployee(req.params.id, { isActive: false });
    res.json({ message: 'User deactivated' });
  } catch (err) { next(err); }
}

/**
 * POST /admin/users/:id/reset-password — a manager-triggered escape hatch for
 * a locked-out coworker (there's no other recovery path for a staff account
 * besides the self-service /auth/forgot-password email, which requires the
 * user to still have access to their own inbox). Sends the same reset-link
 * email as the self-service flow rather than setting a password directly, so
 * the manager never sees or chooses the new password.
 */
export async function resetUserPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!target) throw new AppError(404, 'User not found');
    // Without this, a manager could mail themselves a reset link for the
    // SUPER_ADMIN's account — password reset is account takeover.
    assertCanManage(req.user!.role, target.role);
    if (!target.isActive) throw new AppError(400, 'Cannot reset the password of a deactivated user');

    await prisma.passwordResetToken.updateMany({
      where: { userId: target.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: target.id,
        tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`;
    await sendMail({ ...emailTemplates.passwordReset(target.email, target.name, resetLink), orgId: req.user!.orgId }).catch(() => {});

    res.json({ message: `Password reset link sent to ${target.email}` });
  } catch (err) { next(err); }
}

/**
 * Reports users who have no employee record, and optionally creates them.
 *
 * Needed because employee provisioning is deliberately non-throwing (a failure
 * there must never break a login), and because a database that upgraded without
 * running the backfill would otherwise leave HR permanently blind to some
 * staff. `POST /admin/users/reconcile-employees?fix=true` repairs them.
 *
 * Employees without a login are reported but never "repaired" — staff who don't
 * sign in are a legitimate state, and the reason the two models are separate.
 */
export async function reconcileEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const fix = req.query.fix === 'true';
    const report = await reconcileOrphans(req.user!.orgId, fix);
    res.json({
      ...report,
      message: fix
        ? `Created ${report.created} employee record(s).`
        : `${report.usersWithoutEmployee} user(s) have no employee record. Re-run with ?fix=true to create them.`,
    });
  } catch (err) { next(err); }
}

/** Links an existing login to an existing employee, for records created separately. */
export async function linkEmployee(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { employeeId } = z.object({ employeeId: z.string().min(1) }).parse(req.body);
    await linkUserToEmployee(req.user!.orgId, employeeId, req.params.id);
    res.json({ message: 'Login linked to the employee record' });
  } catch (err: any) {
    if (err?.message && !err.status) return next(new AppError(400, err.message));
    next(err);
  }
}
