import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { prisma } from '../../utils/prisma';
// Directory-provisioned staff get an employee record like anyone else.
import { ensureEmployeeForUser, syncUserToEmployee } from '../../utils/employeeProvisioning';
import { decryptSecret } from '../../utils/crypto';
import { getAppOnlyToken, fetchGroupMembers } from '../../utils/entraAuth';
import { assertSeatAvailable } from '../../utils/licensing';
import { logAction } from '../../utils/auditLog';

export interface SyncResult {
  orgId: string;
  status: 'OK' | 'ERROR';
  usersCreated: number;
  usersDeactivated: number;
  errorMessage?: string;
}

/**
 * Phase 3: one org's unattended directory sync — pre-creates accounts for
 * everyone currently in a mapped Entra security group who doesn't have one
 * yet, and deactivates directory-provisioned accounts for people no longer
 * in any mapped group. Shares role-resolution logic (highest-priority
 * mapping wins, else the org's default role) with the JIT path in
 * auth.controller.ts entraCallback() via the same DirectoryRoleMapping data,
 * though it can't reuse resolveRoleForGroups() directly since it already has
 * each group's members in hand and would otherwise re-fetch per person.
 *
 * `actingUserId` is only set for an admin-triggered "Sync Now" — the
 * unattended cron path (syncAllOrgs, called from the secret-guarded
 * POST /directory/sync-all endpoint) has no real user to attribute audit log
 * rows to, so it skips per-user audit logging and relies on the
 * DirectorySyncLog row this function always writes as the record of what
 * happened.
 */
export async function syncOrgDirectory(orgId: string, actingUserId?: string): Promise<SyncResult> {
  const syncLog = await prisma.directorySyncLog.create({ data: { orgId } });
  let usersCreated = 0;
  let usersDeactivated = 0;

  try {
    const config = await prisma.directoryConfig.findUnique({ where: { orgId } });
    if (!config || !config.isEnabled) {
      throw new Error('Single sign-on is not configured or is disabled for this organization');
    }
    if (!config.autoProvisioningEnabled) {
      throw new Error('Automatic provisioning is off — enable it in Single Sign-On settings before syncing');
    }

    const mappings = await prisma.directoryRoleMapping.findMany({ where: { orgId }, orderBy: { priority: 'desc' } });

    // No mapped groups configured — nothing to pre-create, and (deliberately)
    // nothing to deprovision either: an admin who hasn't set up any mappings
    // yet shouldn't have existing directory-provisioned users mass-deactivated
    // as a side effect.
    if (mappings.length > 0) {
      const appToken = await getAppOnlyToken({
        tenantId: config.tenantId, clientId: config.clientId, clientSecret: decryptSecret(config.clientSecretEnc),
      });

      // entraObjectId -> which mapped group(s) they currently belong to, and
      // their Graph profile (last one wins if listed under multiple groups —
      // profile fields don't vary by group).
      const memberGroups = new Map<string, string[]>();
      const profileById = new Map<string, { mail: string | null; userPrincipalName: string; displayName: string; accountEnabled: boolean }>();

      for (const mapping of mappings) {
        const members = await fetchGroupMembers(appToken, mapping.groupId);
        for (const m of members) {
          if (!memberGroups.has(m.id)) memberGroups.set(m.id, []);
          memberGroups.get(m.id)!.push(mapping.groupId);
          profileById.set(m.id, m);
        }
      }

      // Pre-create anyone in a mapped group without a CRMITdesk account yet.
      for (const [entraId, groupIds] of memberGroups) {
        const profile = profileById.get(entraId)!;
        if (!profile.accountEnabled) continue; // disabled in Entra — don't create a fresh account for them

        const email = (profile.mail || profile.userPrincipalName || '').toLowerCase();

        const existing = await prisma.user.findFirst({
          where: { orgId, OR: [{ entraObjectId: entraId }, ...(email ? [{ email }] : [])] },
        });
        if (existing) {
          if (!existing.entraObjectId) await prisma.user.update({ where: { id: existing.id }, data: { entraObjectId: entraId } });
          continue;
        }
        if (!email) continue; // can't create an account with no address to identify them by

        const matchedMappings = mappings.filter(m => groupIds.includes(m.groupId));
        const role: UserRole = matchedMappings[0]?.role ?? config.defaultRole;

        try {
          await assertSeatAvailable(orgId, role);
        } catch {
          continue; // seat limit hit for this role — skip them, keep syncing the rest
        }

        const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
        const user = await prisma.user.create({
          data: { name: profile.displayName, email, passwordHash, role, orgId, entraObjectId: entraId, provisionedVia: 'DIRECTORY' },
        });
        usersCreated++;
        await ensureEmployeeForUser(user.id);
        if (actingUserId) logAction(actingUserId, 'CREATE', 'User', user.id, { method: 'entra_sync', role });
      }

      // Deprovision: directory-provisioned users no longer in any mapped group.
      const stillMemberIds = new Set(memberGroups.keys());
      const directoryUsers = await prisma.user.findMany({
        where: { orgId, provisionedVia: 'DIRECTORY', isActive: true, entraObjectId: { not: null } },
      });
      for (const u of directoryUsers) {
        if (u.entraObjectId && !stillMemberIds.has(u.entraObjectId)) {
          await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
          // Someone removed from every mapped directory group has left.
          await syncUserToEmployee(u.id, { isActive: false });
          usersDeactivated++;
          if (actingUserId) logAction(actingUserId, 'UPDATE', 'User', u.id, { method: 'entra_sync', deactivated: true });
        }
      }
    }

    await prisma.directorySyncLog.update({
      where: { id: syncLog.id },
      data: { status: 'OK', finishedAt: new Date(), usersCreated, usersDeactivated },
    });
    return { orgId, status: 'OK', usersCreated, usersDeactivated };
  } catch (err: any) {
    const errorMessage = err?.message || 'Sync failed';
    await prisma.directorySyncLog.update({
      where: { id: syncLog.id },
      data: { status: 'ERROR', finishedAt: new Date(), usersCreated, usersDeactivated, errorMessage },
    });
    return { orgId, status: 'ERROR', usersCreated, usersDeactivated, errorMessage };
  }
}

/** Every org with sync eligible (SSO enabled + auto-provisioning on) — used by the unattended cron endpoint. */
export async function syncAllOrgs(): Promise<SyncResult[]> {
  const configs = await prisma.directoryConfig.findMany({
    where: { isEnabled: true, autoProvisioningEnabled: true },
    select: { orgId: true },
  });
  const results: SyncResult[] = [];
  for (const c of configs) {
    results.push(await syncOrgDirectory(c.orgId));
  }
  return results;
}
