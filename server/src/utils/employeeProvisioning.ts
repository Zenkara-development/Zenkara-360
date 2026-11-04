/**
 * Keeps User and Employee in step automatically.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 * Splitting Employee out of User was necessary — a factory with 500 staff and
 * 40 logins cannot be modelled with one table, and payroll data has no business
 * living on an auth record. But done naively the split creates a worse problem
 * than it fixed: an admin now has to add every new starter *twice*, once in
 * Administration → Users and again in HR → Employees, and the two drift apart
 * within a month.
 *
 * So the split is real in the database and invisible in day-to-day use:
 *
 *   - Creating a User (invite, admin form, SSO first login, directory sync)
 *     creates the matching Employee automatically.
 *   - Updating a User's name, phone or department syncs to their Employee.
 *   - Deactivating a User marks the Employee as exited.
 *   - The only time anyone touches HR → Employees directly is for staff who
 *     have no login at all — which is exactly the case the old model could not
 *     represent.
 *
 * Every function here is idempotent and non-throwing by design: a failure to
 * provision an Employee must never break the login or invite that triggered it.
 * The worst case is a User with no Employee row, which `linkOrphans()` can
 * repair later and which the admin UI surfaces as "no employee record".
 */
import { prisma } from './prisma';

/** Splits "Jane Q. Doe" into first/last without inventing a middle-name concept. */
function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Unnamed', lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Next code in the EMP-0001 sequence for an org.
 *
 * Derived from the current maximum rather than a counter column, so an org that
 * imports staff with their own codes doesn't collide on the next generated one.
 */
function nextCodeFrom(lastCode?: string | null): string {
  const n = lastCode ? parseInt(lastCode.replace('EMP-', ''), 10) : 0;
  return `EMP-${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, '0')}`;
}

async function nextEmployeeCode(orgId: string): Promise<string> {
  const rows = await prisma.employee.findMany({
    where: { orgId, employeeCode: { startsWith: 'EMP-' } },
    select: { employeeCode: true },
    orderBy: { employeeCode: 'desc' },
    take: 1,
  });
  return nextCodeFrom(rows[0]?.employeeCode);
}

/**
 * Finds or creates the Department matching a free-text department string.
 *
 * This is what stops the old `User.department` string and the new Department
 * table drifting apart: whichever one an admin happens to set, both end up
 * consistent.
 */
async function resolveDepartmentId(orgId: string, name?: string | null): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const existing = await prisma.department.findFirst({
    where: { orgId, name: trimmed },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.department.create({
    data: {
      orgId,
      name: trimmed,
      description: 'Created automatically from a user record.',
    },
    select: { id: true },
  });
  return created.id;
}

export interface EnsureEmployeeOptions {
  /** Skip provisioning entirely — for service accounts and API-only logins. */
  skip?: boolean;
  /** Seed the employee's joining date. Defaults to the user's createdAt. */
  joiningDate?: Date;
  designation?: string | null;
}

/**
 * Creates the Employee for a User if one doesn't already exist.
 *
 * Returns the employee id, or null when provisioning was skipped or failed.
 * Never throws — see the file header for why.
 */
export async function ensureEmployeeForUser(
  userId: string,
  opts: EnsureEmployeeOptions = {}
): Promise<string | null> {
  if (opts.skip) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        orgId: true,
        name: true,
        email: true,
        phone: true,
        department: true,
        avatarUrl: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    // PLATFORM_ADMIN is a cross-org operator account with no orgId — it is not
    // a member of anybody's staff.
    if (!user?.orgId || user.role === 'PLATFORM_ADMIN') return null;

    const existing = await prisma.employee.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) return existing.id;

    const { firstName, lastName } = splitName(user.name);
    const departmentId = await resolveDepartmentId(user.orgId, user.department);

    const employee = await prisma.employee.create({
      data: {
        orgId: user.orgId,
        userId: user.id,
        employeeCode: await nextEmployeeCode(user.orgId),
        firstName,
        lastName,
        displayName: user.name,
        workEmail: user.email,
        phone: user.phone,
        photoUrl: user.avatarUrl,
        departmentId,
        designation: opts.designation ?? null,
        // The user's creation date is the earliest joining date we can actually
        // evidence. Inventing a plausible one would be worse than a date HR can
        // correct in one click.
        joiningDate: opts.joiningDate ?? user.createdAt ?? new Date(),
        employmentType: 'FULL_TIME',
        employmentStatus: user.isActive ? 'ACTIVE' : 'EXITED',
        workMode: 'ONSITE',
      },
      select: { id: true },
    });

    return employee.id;
  } catch (err) {
    console.error(`[employee-provisioning] could not create an employee for user ${userId}`, err);
    return null;
  }
}

/**
 * Pushes User edits onto the linked Employee.
 *
 * Only the fields that genuinely exist on both sides, and only when the caller
 * actually changed them — an undefined value means "not submitted", which must
 * not be written as a null over good HR data.
 */
export async function syncUserToEmployee(
  userId: string,
  changes: { name?: string; phone?: string | null; department?: string | null; isActive?: boolean }
): Promise<void> {
  try {
    const employee = await prisma.employee.findUnique({
      where: { userId },
      select: { id: true, orgId: true, employmentStatus: true },
    });
    if (!employee) return;

    const data: Record<string, unknown> = {};

    if (changes.name !== undefined) {
      const { firstName, lastName } = splitName(changes.name);
      data.firstName = firstName;
      data.lastName = lastName;
      data.displayName = changes.name;
    }
    if (changes.phone !== undefined) data.phone = changes.phone;
    if (changes.department !== undefined) {
      data.departmentId = await resolveDepartmentId(employee.orgId, changes.department);
    }
    // Deactivating a login means the person has left. Reactivating does NOT
    // silently un-exit them: rehiring is an HR decision with its own dates, so
    // that stays a deliberate action in the employee record.
    if (changes.isActive === false && employee.employmentStatus !== 'EXITED') {
      data.employmentStatus = 'EXITED';
    }

    if (Object.keys(data).length) {
      await prisma.employee.update({ where: { id: employee.id }, data });
    }
  } catch (err) {
    console.error(`[employee-provisioning] could not sync user ${userId} to their employee record`, err);
  }
}

/**
 * Links an existing Employee to an existing User.
 *
 * Used when both records already exist unlinked — typically an employee added
 * by HR first, who is later given a login. Throws, unlike the rest of this
 * module, because this one is an explicit user action whose failure should be
 * reported rather than swallowed.
 */
export async function linkUserToEmployee(
  orgId: string,
  employeeId: string,
  userId: string
): Promise<void> {
  const [employee, user, alreadyLinked] = await Promise.all([
    prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, userId: true } }),
    prisma.user.findFirst({ where: { id: userId, orgId }, select: { id: true } }),
    prisma.employee.findUnique({ where: { userId }, select: { id: true } }),
  ]);

  if (!employee) throw new Error('Employee not found');
  if (!user) throw new Error('User not found in this organization');
  if (employee.userId) throw new Error('That employee already has a login linked');
  if (alreadyLinked) throw new Error('That login is already linked to another employee');

  await prisma.employee.update({ where: { id: employeeId }, data: { userId } });
}

export interface OrphanReport {
  usersWithoutEmployee: number;
  employeesWithoutUser: number;
  created: number;
}

/**
 * Reports — and optionally repairs — users who have no employee record.
 *
 * Two reasons this exists beyond the initial backfill: a provisioning call can
 * fail silently by design (see the header), and users created before this
 * feature shipped in a database that never ran the backfill would otherwise stay
 * invisible to HR forever.
 *
 * `employeesWithoutUser` is reported but never "repaired" — staff without a
 * login are a legitimate, expected state, not a defect.
 */
export async function reconcileOrphans(orgId: string, fix = false): Promise<OrphanReport> {
  const [usersWithout, employeesWithout] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, employee: { is: null }, role: { not: 'PLATFORM_ADMIN' } },
      select: { id: true },
    }),
    prisma.employee.count({ where: { orgId, userId: null } }),
  ]);

  let created = 0;
  if (fix) {
    for (const u of usersWithout) {
      const id = await ensureEmployeeForUser(u.id);
      if (id) created++;
    }
  }

  return {
    usersWithoutEmployee: usersWithout.length,
    employeesWithoutUser: employeesWithout,
    created,
  };
}

/** Pure helpers exposed for unit testing — not part of the public API. */
export const __testables = { splitName, nextCodeFrom };
