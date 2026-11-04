/**
 * Backfill for the Employee / Department / Task / Approval / Permission
 * foundation.
 *
 * Run ONCE per database, after `prisma migrate deploy`:
 *
 *     npx ts-node prisma/backfill-people-platform.ts
 *     npx ts-node prisma/backfill-people-platform.ts --dry-run
 *
 * ── You do NOT re-enter anyone ────────────────────────────────────────────
 * This script creates an Employee for every User you already have. Going
 * forward, utils/employeeProvisioning.ts creates one automatically whenever a
 * user is invited, created by an admin, or provisioned by SSO/directory sync —
 * so "add a new starter" stays one job, not two. HR → Employees is only
 * touched directly for staff who have no login at all, which is precisely the
 * case the old User-only model could not represent.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *  1. Seeds the global permission catalog and the nine built-in roles.
 *  2. Creates a Department per distinct `User.department` string, per org.
 *  3. Creates an Employee for every existing User, linked to that department.
 *  4. Links each User to the matching Role row (keeping `User.role` as-is).
 *  5. Creates a sensible default approval policy for leave, if none exists.
 *
 * ── What it deliberately does NOT do ──────────────────────────────────────
 *  - It does not clear `User.department`. That column stays populated as a
 *    deprecated mirror so every existing query, report, filter and e2e spec
 *    that reads it keeps returning the same strings. Department.id is now
 *    authoritative; the string is derived.
 *  - It does not invent a reporting hierarchy. Guessing who reports to whom
 *    from a free-text department name would produce a plausible-looking org
 *    chart that is wrong, and wrong hierarchy data silently corrupts
 *    TEAM-scoped permissions and manager-based approvals. Managers are left
 *    null for a human to set.
 *  - It does not change any role's effective access. The seeded grants mirror
 *    what each legacy role could already do.
 *
 * Idempotent: safe to re-run. Every step checks for existing rows first.
 */
import { PrismaClient } from '@prisma/client';
import { seedPermissionCatalog, SYSTEM_ROLES } from '../src/utils/permissions';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function log(msg: string): void {
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}${msg}`);
}

/** Splits "Jane Q. Doe" into first/last without inventing a middle-name concept. */
function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function main(): Promise<void> {
  console.log('─'.repeat(70));
  console.log(DRY_RUN ? 'BACKFILL — DRY RUN (no writes)' : 'BACKFILL — applying changes');
  console.log('─'.repeat(70));

  // ── 1. Permission catalog + built-in roles ────────────────────────────────
  if (!DRY_RUN) {
    await seedPermissionCatalog();
  }
  log(`Seeded ${SYSTEM_ROLES.length} built-in roles and the permission catalog.`);

  const roles = DRY_RUN ? [] : await prisma.role.findMany({ where: { orgId: null } });
  const roleByLegacy = new Map(roles.filter(r => r.legacyRole).map(r => [r.legacyRole!, r]));

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  log(`Found ${orgs.length} organization(s).`);

  let totalDepartments = 0;
  let totalEmployees = 0;
  let totalLinked = 0;
  let totalPolicies = 0;

  for (const org of orgs) {
    const users = await prisma.user.findMany({
      where: { orgId: org.id },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true,
        role: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!users.length) {
      log(`  ${org.name}: no users, skipping.`);
      continue;
    }

    // ── 2. Departments from the distinct free-text strings ──────────────────
    const deptNames = [...new Set(users.map(u => u.department).filter((d): d is string => !!d?.trim()))];

    const deptIdByName = new Map<string, string>();
    for (const name of deptNames) {
      const existing = await prisma.department.findFirst({ where: { orgId: org.id, name } });
      if (existing) {
        deptIdByName.set(name, existing.id);
        continue;
      }
      if (DRY_RUN) {
        deptIdByName.set(name, `dry-${name}`);
        totalDepartments++;
        continue;
      }
      const created = await prisma.department.create({
        data: {
          orgId: org.id,
          name,
          description: `Created automatically from existing user records during the people-platform backfill.`,
        },
      });
      deptIdByName.set(name, created.id);
      totalDepartments++;
    }

    // ── 3. An Employee per User ─────────────────────────────────────────────
    // Employee codes continue from whatever already exists rather than
    // restarting at 1, so re-running after a partial failure doesn't collide.
    const existingCodes = await prisma.employee.findMany({
      where: { orgId: org.id, employeeCode: { startsWith: 'EMP-' } },
      select: { employeeCode: true },
      orderBy: { employeeCode: 'desc' },
      take: 1,
    });
    let seq = existingCodes[0] ? parseInt(existingCodes[0].employeeCode.replace('EMP-', ''), 10) || 0 : 0;

    for (const user of users) {
      // PLATFORM_ADMIN is a cross-org operator account, not a member of staff.
      if (user.role === 'PLATFORM_ADMIN') continue;

      const already = await prisma.employee.findUnique({ where: { userId: user.id } });
      if (already) continue;

      seq++;
      const code = `EMP-${String(seq).padStart(4, '0')}`;
      const { firstName, lastName } = splitName(user.name);
      const departmentId = user.department ? deptIdByName.get(user.department) ?? null : null;

      if (DRY_RUN) {
        totalEmployees++;
        continue;
      }

      await prisma.employee.create({
        data: {
          orgId: org.id,
          userId: user.id,
          employeeCode: code,
          firstName,
          lastName,
          displayName: user.name,
          workEmail: user.email,
          phone: user.phone,
          photoUrl: user.avatarUrl,
          departmentId,
          // Best available truth: when the login was created. Not a guess —
          // it's the earliest date we can actually evidence, and HR can
          // correct it. Inventing a plausible joining date would be worse.
          joiningDate: user.createdAt,
          employmentType: 'FULL_TIME',
          employmentStatus: user.isActive ? 'ACTIVE' : 'EXITED',
          workMode: 'ONSITE',
        },
      });
      totalEmployees++;
    }

    // ── 4. Link users to Role rows ──────────────────────────────────────────
    for (const user of users) {
      const role = roleByLegacy.get(user.role);
      if (!role) continue;
      if (DRY_RUN) {
        totalLinked++;
        continue;
      }
      await prisma.user.update({ where: { id: user.id }, data: { roleId: role.id } });
      totalLinked++;
    }

    // ── 5. A default leave-approval policy ──────────────────────────────────
    const hasLeavePolicy = await prisma.approvalPolicy.findFirst({
      where: { orgId: org.id, entityType: 'LEAVE_REQUEST' },
    });

    if (!hasLeavePolicy) {
      if (DRY_RUN) {
        totalPolicies++;
      } else {
        await prisma.approvalPolicy.create({
          data: {
            orgId: org.id,
            name: 'Standard leave approval',
            description:
              'Manager approves. Requests of more than 5 days additionally need HR. Created by the people-platform backfill; edit or deactivate freely.',
            entityType: 'LEAVE_REQUEST',
            mode: 'SEQUENTIAL',
            expiryHours: 168,
            escalateAfterHours: 48,
            priority: 0,
            steps: {
              create: [
                { order: 1, name: 'Reporting manager', approverType: 'MANAGER', minApprovals: 1 },
                {
                  order: 2,
                  name: 'HR',
                  approverType: 'ROLE',
                  approverRoleKey: 'HR_MANAGER',
                  minApprovals: 1,
                  isOptional: true,
                  conditions: [{ field: 'days', op: 'gt', value: 5 }],
                },
              ],
            },
          },
        });
        totalPolicies++;
      }
    }

    log(
      `  ${org.name}: ${deptNames.length} department(s), ${users.length} user(s) processed.`
    );
  }

  console.log('─'.repeat(70));
  console.log(`Departments created : ${totalDepartments}`);
  console.log(`Employees created   : ${totalEmployees}`);
  console.log(`Users linked to Role: ${totalLinked}`);
  console.log(`Leave policies      : ${totalPolicies}`);
  console.log('─'.repeat(70));

  if (DRY_RUN) {
    console.log('\nDry run only — nothing was written. Re-run without --dry-run to apply.');
  } else {
    console.log('\nDone. Next steps:');
    console.log('  1. Set reporting managers (Employee.managerId) — intentionally left blank.');
    console.log('  2. Set department heads (Department.headId).');
    console.log('  3. Review the built-in roles under Administration → Roles & Permissions.');
    console.log('  4. Run POST /api/knowledge/reindex to build the AI knowledge index.');
  }
}

main()
  .catch(err => {
    console.error('\nBackfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
