import { prisma } from '../../utils/prisma';
import { UserRole } from '@prisma/client';

/**
 * Picks a CRMITdesk role for someone based on their Entra security group
 * memberships — the highest-`priority` DirectoryRoleMapping match wins;
 * falls back to the org's configured default role if none of their groups
 * are mapped (or they aren't in any group at all). Shared by phase 2's
 * JIT-provisioning path (auth.controller.ts entraCallback) and phase 3's
 * scheduled sync (directorySync.ts) so the two can never disagree about who
 * gets what role.
 */
export async function resolveRoleForGroups(orgId: string, groupIds: string[], defaultRole: UserRole): Promise<UserRole> {
  if (groupIds.length === 0) return defaultRole;
  const mappings = await prisma.directoryRoleMapping.findMany({
    where: { orgId, groupId: { in: groupIds } },
    orderBy: { priority: 'desc' },
  });
  return mappings[0]?.role ?? defaultRole;
}
