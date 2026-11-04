import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { encryptSecret, secretsMatch } from '../../utils/crypto';
import { entraRedirectUri, testEntraTenant } from '../../utils/entraAuth';
import { UserRole } from '@prisma/client';
import { syncOrgDirectory, syncAllOrgs } from './directorySync';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Same list usersAdmin.controller.ts's CreateSchema/InviteSchema use —
// PLATFORM_ADMIN is deliberately excluded, it's never assignable via normal
// org UI (cross-org, created only via the platform bootstrap endpoint).
const ROLE_VALUES = ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP', 'IT_MANAGER', 'IT_AGENT', 'EMPLOYEE'] as const;

const ConfigSchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  // Blank means "keep the existing secret" — the form never round-trips the
  // real secret back to the client (see getConfig below), so a save that
  // doesn't touch this field must not overwrite it with an empty string.
  clientSecret: z.string().optional(),
  loginSlug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only'),
  isEnabled: z.boolean().default(true),
  autoProvisioningEnabled: z.boolean().default(false),
  defaultRole: z.enum(ROLE_VALUES).default('EMPLOYEE'),
});

function configResponse(config: { tenantId: string; clientId: string; clientSecretEnc: string; loginSlug: string; isEnabled: boolean; autoProvisioningEnabled: boolean; defaultRole: string; updatedAt: Date }) {
  return {
    tenantId: config.tenantId,
    clientId: config.clientId,
    hasClientSecret: !!config.clientSecretEnc,
    loginSlug: config.loginSlug,
    isEnabled: config.isEnabled,
    autoProvisioningEnabled: config.autoProvisioningEnabled,
    defaultRole: config.defaultRole,
    loginUrl: `${FRONTEND_URL}/login/${config.loginSlug}`,
    redirectUri: entraRedirectUri(),
    updatedAt: config.updatedAt,
  };
}

/** GET /directory/config — never returns the actual secret, just whether one is set */
export async function getConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const config = await prisma.directoryConfig.findUnique({ where: { orgId: req.user!.orgId } });
    res.json(config ? configResponse(config) : null);
  } catch (err) { next(err); }
}

export async function saveConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = ConfigSchema.parse(req.body);

    const existing = await prisma.directoryConfig.findUnique({ where: { orgId } });
    if (!data.clientSecret && !existing) {
      throw new AppError(400, 'A client secret is required');
    }

    // Encrypted at most once (previously this could run twice — once for
    // `update`, once for `create` — even though only one of the two branches
    // is ever actually used for a given save).
    const clientSecretEnc = data.clientSecret ? encryptSecret(data.clientSecret) : undefined;

    try {
      const config = await prisma.directoryConfig.upsert({
        where: { orgId },
        create: {
          orgId,
          tenantId: data.tenantId,
          clientId: data.clientId,
          clientSecretEnc: clientSecretEnc!, // guaranteed set — see the `existing` check above
          loginSlug: data.loginSlug,
          isEnabled: data.isEnabled,
          autoProvisioningEnabled: data.autoProvisioningEnabled,
          defaultRole: data.defaultRole,
        },
        update: {
          tenantId: data.tenantId,
          clientId: data.clientId,
          loginSlug: data.loginSlug,
          isEnabled: data.isEnabled,
          autoProvisioningEnabled: data.autoProvisioningEnabled,
          defaultRole: data.defaultRole,
          ...(clientSecretEnc ? { clientSecretEnc } : {}),
        },
      });
      res.json(configResponse(config));
    } catch (err: any) {
      if (err.code === 'P2002') throw new AppError(409, 'That sign-in link is already taken — choose a different one');
      throw err;
    }
  } catch (err) { next(err); }
}

export async function deleteConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.directoryConfig.deleteMany({ where: { orgId: req.user!.orgId } });
    res.json({ message: 'Single sign-on disconnected' });
  } catch (err) { next(err); }
}

/** POST /directory/test — confirms the tenant ID is real/reachable; can't validate the client secret without a real sign-in */
export async function testConnection(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const config = await prisma.directoryConfig.findUnique({ where: { orgId: req.user!.orgId } });
    if (!config) return res.status(400).json({ error: 'No single sign-on configuration found' });
    const result = await testEntraTenant(config.tenantId);
    if (!result.ok) return res.status(400).json({ error: result.error || 'Could not reach that tenant' });
    res.json({ message: 'Tenant found — client ID and secret are verified the first time someone signs in.' });
  } catch (err) { next(err); }
}

// --- Group-to-role mapping CRUD ---------------------------------------
// DirectoryRoleMapping rows aren't DB-linked to DirectoryConfig (see
// schema.prisma comment), so "must have single sign-on configured first" is
// enforced here rather than via a foreign key.

const MappingSchema = z.object({
  groupId: z.string().min(1),
  groupLabel: z.string().min(1),
  role: z.enum(ROLE_VALUES),
  priority: z.number().int().default(0),
});

async function requireDirectoryConfig(orgId: string) {
  const config = await prisma.directoryConfig.findUnique({ where: { orgId } });
  if (!config) throw new AppError(400, 'Set up single sign-on before adding group mappings');
  return config;
}

/** GET /directory/mappings */
export async function listMappings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const mappings = await prisma.directoryRoleMapping.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { priority: 'desc' },
    });
    res.json(mappings);
  } catch (err) { next(err); }
}

/** POST /directory/mappings */
export async function createMapping(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await requireDirectoryConfig(orgId);
    const data = MappingSchema.parse(req.body);
    try {
      const mapping = await prisma.directoryRoleMapping.create({
        data: { orgId, groupId: data.groupId, groupLabel: data.groupLabel, role: data.role as UserRole, priority: data.priority },
      });
      res.status(201).json(mapping);
    } catch (err: any) {
      if (err.code === 'P2002') throw new AppError(409, 'That group is already mapped — edit the existing mapping instead');
      throw err;
    }
  } catch (err) { next(err); }
}

/** PATCH /directory/mappings/:id */
export async function updateMapping(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = MappingSchema.partial().parse(req.body);
    const existing = await prisma.directoryRoleMapping.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Mapping not found');
    const mapping = await prisma.directoryRoleMapping.update({
      where: { id: existing.id },
      data: {
        ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
        ...(data.groupLabel !== undefined ? { groupLabel: data.groupLabel } : {}),
        ...(data.role !== undefined ? { role: data.role as UserRole } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
      },
    });
    res.json(mapping);
  } catch (err) { next(err); }
}

/** DELETE /directory/mappings/:id */
export async function deleteMapping(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const result = await prisma.directoryRoleMapping.deleteMany({ where: { id: req.params.id, orgId } });
    if (result.count === 0) throw new AppError(404, 'Mapping not found');
    res.json({ message: 'Mapping removed' });
  } catch (err) { next(err); }
}

// --- Phase 3: sync ------------------------------------------------------

/** POST /directory/sync — admin-triggered "Sync Now", attributed to the calling IT manager. */
export async function syncNow(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await syncOrgDirectory(req.user!.orgId, req.user!.id);
    if (result.status === 'ERROR') return res.status(400).json({ error: result.errorMessage });
    res.json(result);
  } catch (err) { next(err); }
}

/** GET /directory/sync-logs — recent sync run history for this org. */
export async function listSyncLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const logs = await prisma.directorySyncLog.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    res.json(logs);
  } catch (err) { next(err); }
}

/**
 * POST /directory/sync-all — unattended cron target for every org at once.
 * No user JWT — gated by a shared secret header instead, same pattern as
 * demo.controller.ts's resetDemo(). 404s (not 401/403) if the secret isn't
 * configured or doesn't match, so the endpoint's existence isn't observable
 * on a deployment where nobody set DIRECTORY_SYNC_SECRET yet.
 */
export async function syncAll(req: Request, res: Response, next: NextFunction) {
  try {
    const configuredSecret = process.env.DIRECTORY_SYNC_SECRET;
    if (!configuredSecret) throw new AppError(404, 'Not found');
    const providedSecret = req.header('x-directory-sync-secret');
    // Constant-time — see secretsMatch() in utils/crypto.ts.
    if (!secretsMatch(providedSecret, configuredSecret)) throw new AppError(404, 'Not found');

    const results = await syncAllOrgs();
    res.json({ success: true, results, syncedAt: new Date().toISOString() });
  } catch (err) { next(err); }
}
