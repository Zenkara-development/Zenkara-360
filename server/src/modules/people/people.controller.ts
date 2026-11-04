import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { emailField } from '../../utils/zodHelpers';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { parsePagination, paginate } from '../../utils/pagination';
import { logAction } from '../../utils/auditLog';
import { assertSeatAvailable } from '../../utils/licensing';
import { sendMail } from '../../utils/mailer';
import {
  getPermCtx,
  assertCan,
  scopedWhere,
  redact,
  invalidatePermCtx,
} from '../../utils/permissions';
import { ensureEmployeeForUser, syncUserToEmployee } from '../../utils/employeeProvisioning';

/**
 * One "People" surface over two tables.
 *
 * ── Why a facade rather than a merge ──────────────────────────────────────
 * User and Employee stay separate in the database for three concrete reasons:
 * a login consumes a metered seat (utils/licensing.ts), `User.email` is
 * globally unique so login-less staff would need fabricated addresses, and
 * bank/tax/national-ID columns have no business sitting on an auth record.
 *
 * But none of that is the admin's problem. From the outside there is one list
 * of people, some of whom can sign in. This module is what makes that true:
 * every read returns the union, and every write decides for itself which
 * table(s) to touch. The client never orchestrates two calls or reasons about
 * which entity it is looking at.
 *
 * The employee record is the spine — auto-provisioning (utils/
 * employeeProvisioning.ts) guarantees one exists for every user. Users without
 * one are surfaced too, because that state means provisioning failed and
 * hiding it would hide a bug.
 */

// ─── Shared shape ─────────────────────────────────────────────────────────────

export interface Person {
  /** Employee id when one exists, otherwise `user:<id>` for an unprovisioned login. */
  id: string;
  employeeId: string | null;
  userId: string | null;
  employeeCode: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; displayName: string } | null;
  employmentStatus: string | null;
  employmentType: string | null;
  joiningDate: Date | null;
  photoUrl: string | null;
  /** True when this person can sign in and the login is active. */
  hasLogin: boolean;
  loginActive: boolean;
  role: string | null;
  roleId: string | null;
  roleName: string | null;
}

const employeeInclude = {
  department: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  manager: { select: { id: true, displayName: true } },
  user: {
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      roleId: true,
      roleRef: { select: { id: true, name: true } },
    },
  },
};

function fromEmployee(e: any): Person {
  return {
    id: e.id,
    employeeId: e.id,
    userId: e.user?.id ?? null,
    employeeCode: e.employeeCode,
    displayName: e.displayName,
    email: e.user?.email ?? e.workEmail ?? null,
    phone: e.phone,
    designation: e.designation,
    department: e.department,
    location: e.location,
    manager: e.manager,
    employmentStatus: e.employmentStatus,
    employmentType: e.employmentType,
    joiningDate: e.joiningDate,
    photoUrl: e.photoUrl,
    hasLogin: !!e.user,
    loginActive: !!e.user?.isActive,
    role: e.user?.role ?? null,
    roleId: e.user?.roleId ?? null,
    roleName: e.user?.roleRef?.name ?? e.user?.role ?? null,
  };
}

/** A login with no employee record — provisioning failed, or it predates HR. */
function fromOrphanUser(u: any): Person {
  return {
    id: `user:${u.id}`,
    employeeId: null,
    userId: u.id,
    employeeCode: null,
    displayName: u.name,
    email: u.email,
    phone: u.phone,
    designation: null,
    department: null,
    location: null,
    manager: null,
    employmentStatus: null,
    employmentType: null,
    joiningDate: null,
    photoUrl: u.avatarUrl,
    hasLogin: true,
    loginActive: u.isActive,
    role: u.role,
    roleId: u.roleId ?? null,
    roleName: u.roleRef?.name ?? u.role,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.read');

    const orgId = req.user!.orgId;
    const { search, departmentId, employmentStatus, login } = req.query as Record<string, string>;

    const where: any = { orgId, ...scopedWhere(ctx, 'employee', 'hr.employee.read') };
    if (departmentId) where.departmentId = departmentId;
    if (employmentStatus) where.employmentStatus = employmentStatus;
    // `login=yes|no` is the filter that makes the two-table reality visible
    // exactly where it is useful, and invisible everywhere else.
    if (login === 'yes') where.userId = { not: null };
    if (login === 'no') where.userId = null;
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { workEmail: { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pag = parsePagination(req);
    const [employees, employeeTotal] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: employeeInclude,
        orderBy: { displayName: 'asc' },
        take: pag.limit,
        skip: pag.skip,
      }),
      prisma.employee.count({ where }),
    ]);

    // Orphan logins only belong in the "all" and "can sign in" views — a user
    // with no employee record is by definition not a person without a login.
    let orphans: Person[] = [];
    if (login !== 'no') {
      const rows = await prisma.user.findMany({
        where: {
          orgId,
          employee: { is: null },
          role: { not: 'PLATFORM_ADMIN' },
          ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          role: true,
          roleId: true,
          roleRef: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      });
      orphans = rows.map(fromOrphanUser);
    }

    const people = [...employees.map(e => redact(ctx, 'employee', fromEmployee(e))), ...orphans];

    res.json(paginate(people, employeeTotal + orphans.length, pag));
  } catch (err) {
    next(err);
  }
}

export async function stats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.read');
    const orgId = req.user!.orgId;

    const [total, withLogin, withoutLogin, onNotice, orphanLogins, activeLogins] = await Promise.all([
      prisma.employee.count({ where: { orgId } }),
      prisma.employee.count({ where: { orgId, userId: { not: null } } }),
      prisma.employee.count({ where: { orgId, userId: null } }),
      prisma.employee.count({ where: { orgId, employmentStatus: 'NOTICE_PERIOD' } }),
      prisma.user.count({ where: { orgId, employee: { is: null }, role: { not: 'PLATFORM_ADMIN' } } }),
      prisma.user.count({ where: { orgId, isActive: true, role: { not: 'PLATFORM_ADMIN' } } }),
    ]);

    res.json({
      total: total + orphanLogins,
      canSignIn: withLogin + orphanLogins,
      noLogin: withoutLogin,
      onNotice,
      activeLogins,
      // Surfaced so the UI can offer the one-click repair rather than leaving
      // these people quietly missing from HR.
      unlinkedLogins: orphanLogins,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  joiningDate: z.string(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY']).optional(),

  /**
   * How this person gets access.
   *   none     — staff who never sign in. No seat consumed, no email needed.
   *   password — admin sets one now.
   *   invite   — they set their own via an emailed link.
   */
  loginMode: z.enum(['none', 'password', 'invite']).default('none'),
  email: emailField().optional(),
  password: z.string().min(8).optional(),
  roleId: z.string().optional(),
});

/**
 * Adds a person, with or without a login, in one call.
 *
 * The whole point of this endpoint: an admin says "new starter, here are their
 * details, yes they need access" once — rather than creating a user in one
 * screen and an employee in another and hoping the two agree.
 */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.create');

    const orgId = req.user!.orgId;
    const data = CreateSchema.parse(req.body);
    const displayName = [data.firstName, data.lastName].filter(Boolean).join(' ');

    if (data.loginMode !== 'none' && !data.email) {
      throw new AppError(400, 'An email address is required to give someone a login');
    }
    if (data.loginMode === 'password' && !data.password) {
      throw new AppError(400, 'Set a password, or choose to send an invite instead');
    }

    let userId: string | null = null;
    let inviteLink: string | null = null;

    if (data.loginMode !== 'none') {
      assertCan(ctx, 'core.user.create');
      const clash = await prisma.user.findUnique({ where: { email: data.email! } });
      if (clash) throw new AppError(409, 'That email address already has an account');

      const role = data.roleId
        ? await prisma.role.findFirst({
            where: { id: data.roleId, OR: [{ orgId }, { orgId: null }] },
            select: { id: true, legacyRole: true },
          })
        : null;
      const legacyRole = (role?.legacyRole ?? 'EMPLOYEE') as any;
      await assertSeatAvailable(orgId, legacyRole);

      if (data.loginMode === 'password') {
        const user = await prisma.user.create({
          data: {
            orgId,
            name: displayName,
            email: data.email!,
            passwordHash: await bcrypt.hash(data.password!, 12),
            role: legacyRole,
            roleId: role?.id ?? null,
            phone: data.phone ?? null,
          },
          select: { id: true },
        });
        userId = user.id;
      } else {
        const token = crypto.randomBytes(32).toString('hex');
        await prisma.inviteToken.create({
          data: {
            orgId,
            email: data.email!,
            role: legacyRole,
            roleId: role?.id ?? null,
            token,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite?token=${token}`;

        const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
        sendMail({
          orgId,
          to: data.email!,
          subject: `You've been invited to join ${org?.name ?? 'the team'}`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
            <h2 style="color:#4f46e5">You're invited</h2>
            <p>You've been added to <strong>${org?.name ?? 'the team'}</strong>. Set up your account below — this link expires in 7 days.</p>
            <a href="${inviteLink}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Accept Invitation</a>
            <p style="color:#6b7280;font-size:13px">Or copy this link: ${inviteLink}</p>
          </div>`,
        }).catch(() => {});
      }
    }

    // The employee record is created directly rather than via
    // ensureEmployeeForUser, because we hold richer details here (designation,
    // manager, joining date) than that helper can infer from a user row.
    const codeRows = await prisma.employee.findMany({
      where: { orgId, employeeCode: { startsWith: 'EMP-' } },
      select: { employeeCode: true },
      orderBy: { employeeCode: 'desc' },
      take: 1,
    });
    const lastNum = codeRows[0] ? parseInt(codeRows[0].employeeCode.replace('EMP-', ''), 10) : 0;
    const employeeCode = `EMP-${String((Number.isFinite(lastNum) ? lastNum : 0) + 1).padStart(4, '0')}`;

    const employee = await prisma.employee.create({
      data: {
        orgId,
        userId,
        employeeCode,
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        displayName,
        workEmail: data.email ?? null,
        phone: data.phone ?? null,
        designation: data.designation ?? null,
        departmentId: data.departmentId ?? null,
        locationId: data.locationId ?? null,
        managerId: data.managerId ?? null,
        joiningDate: new Date(data.joiningDate),
        employmentType: data.employmentType ?? 'FULL_TIME',
        employmentStatus: 'ACTIVE',
      },
      include: employeeInclude,
    });

    logAction(req.user!.id, 'CREATE', 'EMPLOYEE', employee.id, { displayName, loginMode: data.loginMode });
    if (userId) invalidatePermCtx(userId);

    res.status(201).json({ person: fromEmployee(employee), inviteLink });
  } catch (err) {
    next(err);
  }
}

// ─── Login lifecycle ──────────────────────────────────────────────────────────

const GrantLoginSchema = z.object({
  email: emailField(),
  roleId: z.string().optional(),
  mode: z.enum(['password', 'invite']).default('invite'),
  password: z.string().min(8).optional(),
});

/**
 * Gives an existing employee a login.
 *
 * This is the transition the old two-screen model handled worst: a contractor
 * who has been on the books for six months now needs system access, and
 * nothing connected the employee record already on file to the new user.
 */
export async function grantLogin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.user.create');

    const orgId = req.user!.orgId;
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, orgId },
      select: { id: true, userId: true, displayName: true, phone: true },
    });
    if (!employee) throw new AppError(404, 'Person not found');
    if (employee.userId) throw new AppError(400, 'This person already has a login');

    const data = GrantLoginSchema.parse(req.body);
    const clash = await prisma.user.findUnique({ where: { email: data.email } });
    if (clash) throw new AppError(409, 'That email address already has an account');

    const role = data.roleId
      ? await prisma.role.findFirst({
          where: { id: data.roleId, OR: [{ orgId }, { orgId: null }] },
          select: { id: true, legacyRole: true },
        })
      : null;
    const legacyRole = (role?.legacyRole ?? 'EMPLOYEE') as any;
    await assertSeatAvailable(orgId, legacyRole);

    if (data.mode === 'password') {
      if (!data.password) throw new AppError(400, 'Set a password, or send an invite instead');
      const user = await prisma.user.create({
        data: {
          orgId,
          name: employee.displayName,
          email: data.email,
          passwordHash: await bcrypt.hash(data.password, 12),
          role: legacyRole,
          roleId: role?.id ?? null,
          phone: employee.phone,
        },
        select: { id: true },
      });
      await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id, workEmail: data.email } });
      logAction(req.user!.id, 'UPDATE', 'EMPLOYEE', employee.id, { action: 'GRANT_LOGIN' });
      res.json({ message: 'Login created', userId: user.id, inviteLink: null });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.inviteToken.create({
      data: {
        orgId,
        email: data.email,
        role: legacyRole,
        roleId: role?.id ?? null,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.employee.update({ where: { id: employee.id }, data: { workEmail: data.email } });

    const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite?token=${token}`;
    logAction(req.user!.id, 'UPDATE', 'EMPLOYEE', employee.id, { action: 'INVITE_LOGIN' });
    res.json({ message: 'Invite sent', userId: null, inviteLink: link });
  } catch (err) {
    next(err);
  }
}

/**
 * Removes system access while keeping the person on the books.
 *
 * Deliberately deactivates rather than deletes: the login is referenced by
 * audit logs, assigned tickets and owned deals, and destroying it would take
 * that history with it.
 */
export async function revokeLogin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.user.update');

    const orgId = req.user!.orgId;
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, orgId },
      select: { id: true, userId: true },
    });
    if (!employee?.userId) throw new AppError(400, 'This person does not have a login');
    if (employee.userId === req.user!.id) throw new AppError(400, 'You cannot revoke your own access');

    await prisma.user.update({ where: { id: employee.userId }, data: { isActive: false } });
    invalidatePermCtx(employee.userId);
    logAction(req.user!.id, 'UPDATE', 'EMPLOYEE', employee.id, { action: 'REVOKE_LOGIN' });

    res.json({ message: 'Access revoked. The person remains on the employee list.' });
  } catch (err) {
    next(err);
  }
}

const AssignRoleSchema = z.object({ roleId: z.string().min(1) });

/** Changes the role on a person's login, addressed by employee id. */
export async function assignRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'core.user.update');

    const orgId = req.user!.orgId;
    const { roleId } = AssignRoleSchema.parse(req.body);

    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, orgId },
      select: { userId: true },
    });
    if (!employee?.userId) throw new AppError(400, 'This person does not have a login to assign a role to');

    const role = await prisma.role.findFirst({
      where: { id: roleId, OR: [{ orgId }, { orgId: null }] },
      select: { id: true, legacyRole: true, isActive: true },
    });
    if (!role) throw new AppError(404, 'Role not found');
    if (!role.isActive) throw new AppError(400, 'That role is deactivated');

    await prisma.user.update({
      where: { id: employee.userId },
      data: { roleId: role.id, role: (role.legacyRole ?? 'EMPLOYEE') as any },
    });
    invalidatePermCtx(employee.userId);

    res.json({ message: 'Role updated' });
  } catch (err) {
    next(err);
  }
}

/** Creates the missing employee records for logins that never got one. */
export async function repairUnlinked(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.create');

    const orphans = await prisma.user.findMany({
      where: { orgId: req.user!.orgId, employee: { is: null }, role: { not: 'PLATFORM_ADMIN' } },
      select: { id: true },
    });

    let created = 0;
    for (const u of orphans) {
      if (await ensureEmployeeForUser(u.id)) created++;
    }

    res.json({ created, message: `Created ${created} employee record(s).` });
  } catch (err) {
    next(err);
  }
}

/** Keeps the login's name/phone in step when the person record is edited. */
export async function syncFromEmployee(userId: string, changes: { name?: string; phone?: string | null }) {
  await syncUserToEmployee(userId, changes);
}
