import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { validateRecordData } from '../modules/custom-modules/customModules.service';
import { runWorkflows } from './workflow-engine';

// Same setInterval-poller shape as scheduler.ts (see comment there) — one
// Node process, one periodic DB scan, no job queue. Checked every minute;
// each config's own pollIntervalMin decides whether it's actually due.
const POLL_CHECK_INTERVAL_MS = 60 * 1000;

function getByPath(obj: unknown, path?: string | null): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

async function runSyncForConfig(configId: string): Promise<void> {
  const config = await prisma.externalSyncConfig.findUnique({
    where: { id: configId },
    include: { module: { include: { fields: true } } },
  });
  if (!config || !config.isActive) return;

  try {
    const headers: Record<string, string> = {};
    if (config.authType === 'API_KEY' && config.authHeaderName && config.authValue) {
      headers[config.authHeaderName] = config.authValue;
    } else if (config.authType === 'BEARER' && config.authValue) {
      headers['Authorization'] = `Bearer ${config.authValue}`;
    }

    const res = await fetch(config.url, { method: config.method || 'GET', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    const list = getByPath(json, config.recordPath);
    if (!Array.isArray(list)) {
      throw new Error(`recordPath "${config.recordPath || '(response root)'}" did not resolve to an array`);
    }

    const mapping = (config.fieldMapping || {}) as Record<string, string>;
    let ok = 0;
    let failed = 0;

    for (const externalRecord of list) {
      try {
        const mapped: Record<string, unknown> = {};
        for (const [fieldKey, externalKey] of Object.entries(mapping)) {
          mapped[fieldKey] = getByPath(externalRecord, externalKey);
        }
        const data = validateRecordData(config.module.fields, mapped) as Prisma.InputJsonValue;
        const externalId = config.externalIdField
          ? String(getByPath(externalRecord, config.externalIdField) ?? '') || null
          : null;

        if (externalId) {
          /* upsert() can't say whether it created or updated, but automation
             should only fire for NEW arrivals — re-polling the same 200 ERP
             rows every hour must not re-run every rule 200 times. */
          const preExisting = await prisma.customModuleRecord.findUnique({
            where: { moduleId_externalId: { moduleId: config.moduleId, externalId } },
            select: { id: true },
          });
          const row = await prisma.customModuleRecord.upsert({
            where: { moduleId_externalId: { moduleId: config.moduleId, externalId } },
            create: { moduleId: config.moduleId, orgId: config.module.orgId, data, source: 'SYNC', externalId },
            update: { data },
          });
          if (!preExisting) {
            runWorkflows({
              trigger: 'CUSTOM_RECORD_CREATED', orgId: config.module.orgId,
              entityType: 'CUSTOM_MODULE_RECORD', entityId: row.id,
              entity: { ...(data as any), id: row.id, moduleId: config.moduleId, moduleSlug: (config.module as any).slug, moduleName: config.module.name, source: 'SYNC' },
            }).catch(() => {});
          }
        } else {
          // No dedupe key configured — every poll appends new rows. Fine
          // for one-shot/append-only feeds; the UI should nudge admins to
          // set externalIdField for anything polled repeatedly.
          await prisma.customModuleRecord.create({
            data: { moduleId: config.moduleId, orgId: config.module.orgId, data, source: 'SYNC' },
          });
        }
        ok += 1;
      } catch {
        failed += 1; // one bad external record shouldn't abort the whole sync
      }
    }

    await prisma.externalSyncConfig.update({
      where: { id: config.id },
      data: {
        lastSyncAt: new Date(),
        lastStatus: 'SUCCESS',
        lastError: failed ? `${failed} of ${list.length} record(s) failed validation` : null,
        lastRecordCount: ok,
      },
    });
  } catch (err: any) {
    await prisma.externalSyncConfig.update({
      where: { id: config.id },
      data: { lastSyncAt: new Date(), lastStatus: 'FAILED', lastError: String(err?.message || err) },
    }).catch(() => {});
  }
}

async function checkDueSyncs(): Promise<void> {
  const configs = await prisma.externalSyncConfig.findMany({ where: { isActive: true } });
  const now = Date.now();
  for (const config of configs) {
    const dueAt = config.lastSyncAt ? config.lastSyncAt.getTime() + config.pollIntervalMin * 60 * 1000 : 0;
    if (dueAt <= now) {
      await runSyncForConfig(config.id).catch(() => {});
    }
  }
}

export function startCustomModuleSyncPoller() {
  checkDueSyncs().catch(() => {});
  setInterval(() => checkDueSyncs().catch(() => {}), POLL_CHECK_INTERVAL_MS);
}

/** Exposed for the "Sync now" button — runs one config immediately regardless of its due time. */
export async function runSyncNow(configId: string): Promise<void> {
  await runSyncForConfig(configId);
}
