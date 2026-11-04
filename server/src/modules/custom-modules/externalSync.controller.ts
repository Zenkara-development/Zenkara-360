import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { runSyncNow } from '../../utils/customModuleSync';

const SyncConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  authType: z.enum(['NONE', 'API_KEY', 'BEARER']).default('NONE'),
  authHeaderName: z.string().optional(),
  authValue: z.string().optional(),
  pollIntervalMin: z.number().int().min(1).max(1440).default(15),
  recordPath: z.string().optional(),
  externalIdField: z.string().optional(),
  fieldMapping: z.record(z.string()),
  isActive: z.boolean().default(true),
});

async function assertModuleInOrg(moduleId: string, orgId: string) {
  const module_ = await prisma.customModule.findFirst({ where: { id: moduleId, orgId } });
  if (!module_) throw new AppError(404, 'Custom module not found');
  return module_;
}

export async function getSyncConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await assertModuleInOrg(req.params.id, req.user!.orgId);
    const config = await prisma.externalSyncConfig.findUnique({ where: { moduleId: module_.id } });
    res.json(config ?? null);
  } catch (err) { next(err); }
}

export async function upsertSyncConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await assertModuleInOrg(req.params.id, req.user!.orgId);
    const data = SyncConfigSchema.parse(req.body);
    // Every mapped fieldKey must be a real field on this module — otherwise
    // synced data would validate against fields that don't exist and
    // silently vanish (validateRecordData only keeps known fieldKeys).
    const fields = await prisma.customModuleField.findMany({ where: { moduleId: module_.id } });
    const validKeys = new Set(fields.map(f => f.fieldKey));
    const unknownKeys = Object.keys(data.fieldMapping).filter(k => !validKeys.has(k));
    if (unknownKeys.length) throw new AppError(400, `Unknown field key(s) in mapping: ${unknownKeys.join(', ')}`);

    const config = await prisma.externalSyncConfig.upsert({
      where: { moduleId: module_.id },
      create: { moduleId: module_.id, ...data },
      update: { ...data, lastStatus: null, lastError: null }, // config changed — clear stale status until next run
    });
    res.json(config);
  } catch (err) { next(err); }
}

export async function deleteSyncConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await assertModuleInOrg(req.params.id, req.user!.orgId);
    await prisma.externalSyncConfig.deleteMany({ where: { moduleId: module_.id } });
    res.json({ message: 'Sync config removed' });
  } catch (err) { next(err); }
}

export async function triggerSync(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await assertModuleInOrg(req.params.id, req.user!.orgId);
    const config = await prisma.externalSyncConfig.findUnique({ where: { moduleId: module_.id } });
    if (!config) throw new AppError(404, 'No sync config for this module');
    await runSyncNow(config.id);
    const updated = await prisma.externalSyncConfig.findUnique({ where: { moduleId: module_.id } });
    res.json(updated);
  } catch (err) { next(err); }
}
