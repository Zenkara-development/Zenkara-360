import { prisma } from './prisma';
import { ENTITY_MODEL } from './entityAccess';
import * as storage from './storage';

/**
 * Tidies up the polymorphic children of a record that is being deleted.
 *
 * Comments, Attachments and Tasks are all joined to their parent by a loose
 * `entityType` + `entityId` pair rather than a foreign key, so the database
 * cannot cascade them. Nothing cleaned them up, which meant:
 *
 *  - Attachment ROWS survived their parent forever. `remove()` in
 *    attachments.controller.ts calls assertEntityInOrg() *before* deleting,
 *    so once the parent was gone the row 404'd on every delete attempt —
 *    permanently undeletable through the API.
 *  - Attachment BLOBS survived too, in the org's Drive or in our hosted S3
 *    bucket, where they keep counting against the plan's storage quota
 *    (assertHostedStorageAvailable sums fileSize). An org could delete every
 *    record it owns and still be told it is out of space.
 *  - A recycled entityId — cuid collisions are not a practical worry, but
 *    seeded/imported data reusing ids is — would inherit the old record's
 *    comments and files.
 *
 * Everything here is best-effort and never throws: losing a blob delete must
 * not fail the user's delete request, which has usually already committed by
 * the time we are called. Whatever a live purge misses is swept up later by
 * reapOrphanedAttachments().
 */

export interface PurgeResult {
  attachments: number;
  comments: number;
  tasks: number;
  /** Rows deleted but whose stored file could not be removed. */
  orphanedBlobs: number;
}

const EMPTY: PurgeResult = { attachments: 0, comments: 0, tasks: 0, orphanedBlobs: 0 };

/**
 * Deletes the stored files behind the given attachment rows, then the rows.
 * Blob failures are counted, not thrown — a file we cannot reach (revoked
 * Drive token, already deleted upstream) must not strand the row as well,
 * because the row is the only thing that still charges the customer quota.
 */
async function dropAttachments(
  orgId: string,
  rows: Array<{ id: string; provider: string; providerFileId: string }>,
): Promise<{ deleted: number; orphanedBlobs: number }> {
  if (rows.length === 0) return { deleted: 0, orphanedBlobs: 0 };

  let orphanedBlobs = 0;
  for (const row of rows) {
    try {
      await storage.deleteAttachmentFile(orgId, row.provider, row.providerFileId);
    } catch {
      orphanedBlobs++;
    }
  }

  const { count } = await prisma.attachment.deleteMany({ where: { id: { in: rows.map(r => r.id) } } });
  return { deleted: count, orphanedBlobs };
}

/** Every attachment filed against these entities, scoped to the org via the uploader. */
async function attachmentsFor(orgId: string, entityType: string, entityIds: string[]) {
  if (entityIds.length === 0) return [];
  return prisma.attachment.findMany({
    where: { entityType: entityType as any, entityId: { in: entityIds }, uploader: { orgId } },
    select: { id: true, provider: true, providerFileId: true },
  });
}

/**
 * Call this immediately before (or after) deleting a record. Safe to call for
 * an id that turns out not to have had any children.
 *
 * `depth` guards the one case that could recurse: a Task attached to a record
 * is itself an EntityType, so purging a deal's tasks purges each task's own
 * comments and files — but a task attached to a task stops there rather than
 * walking an arbitrarily deep chain inside a request.
 */
export async function purgeEntityChildren(
  entityType: string,
  entityId: string,
  orgId: string,
  depth = 0,
): Promise<PurgeResult> {
  try {
    // Child tasks first: they are parents in their own right, so their
    // comments and attachments have to go before we lose the task ids.
    let tasks = 0;
    const result = { ...EMPTY };

    if (depth < 1) {
      const childTasks = await prisma.task.findMany({
        where: { orgId, entityType: entityType as any, entityId },
        select: { id: true },
      });
      for (const t of childTasks) {
        const nested = await purgeEntityChildren('TASK', t.id, orgId, depth + 1);
        result.attachments += nested.attachments;
        result.comments += nested.comments;
        result.orphanedBlobs += nested.orphanedBlobs;
      }
      if (childTasks.length) {
        tasks = (await prisma.task.deleteMany({ where: { id: { in: childTasks.map(t => t.id) } } })).count;
      }
    }

    const rows = await attachmentsFor(orgId, entityType, [entityId]);
    const dropped = await dropAttachments(orgId, rows);

    const comments = await prisma.comment.deleteMany({
      where: { entityType: entityType as any, entityId, author: { orgId } },
    });

    // Custom-field values and tag links hang off records by the same loose
    // entityId pairing as comments — the database can't cascade them either.
    // Without this, every deleted ticket/deal/contact/lead left its saved
    // custom-field values and record-tag rows behind as permanent orphans
    // (found by the deletion-verification sweep, 2026-08). Both deletes are
    // org-scoped the same way the reads are: values through the field's org,
    // tag links through their own orgId column.
    await prisma.customFieldValue.deleteMany({
      where: { entityId, field: { orgId } },
    }).catch(() => { /* table applies to TICKET/CONTACT/DEAL/LEAD only — best-effort for the rest */ });
    await prisma.recordTag.deleteMany({
      where: { entityType: entityType as any, entityId, orgId },
    }).catch(() => { /* enum narrower than EntityType for some callers — best-effort */ });

    return {
      attachments: result.attachments + dropped.deleted,
      comments: result.comments + comments.count,
      tasks,
      orphanedBlobs: result.orphanedBlobs + dropped.orphanedBlobs,
    };
  } catch (err) {
    // Deliberately swallowed: the parent delete is what the user asked for
    // and it has already happened. reapOrphanedAttachments() is the backstop.
    console.error(`[entityCleanup] purge failed for ${entityType}:${entityId}`, err);
    return { ...EMPTY };
  }
}

/**
 * Sweeps attachments whose parent record no longer exists.
 *
 * purgeEntityChildren() covers deletes that go through a controller, but not
 * the ones the database performs itself: `onDelete: Cascade` appears 128
 * times in the schema, so deleting an Account can take its Deals and Contacts
 * with it without any application code seeing those child ids. This catches
 * that fallout, plus anything a failed live purge left behind.
 *
 * Attachments younger than an hour are skipped so an upload that races a
 * record's creation is never reaped.
 */
export async function reapOrphanedAttachments(options: { batchSize?: number; dryRun?: boolean } = {}) {
  const batchSize = options.batchSize ?? 500;
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const summary = { scanned: 0, orphaned: 0, deleted: 0, orphanedBlobs: 0 };

  for (const entityType of Object.keys(ENTITY_MODEL)) {
    const model = ENTITY_MODEL[entityType];
    let cursor: string | undefined;

    // Paged rather than one big findMany: an org that has been running for a
    // while can have far more attachments than we want resident at once.
    for (;;) {
      const page = await prisma.attachment.findMany({
        where: { entityType: entityType as any, createdAt: { lt: cutoff } },
        select: {
          id: true, entityId: true, provider: true, providerFileId: true,
          uploader: { select: { orgId: true } },
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;
      summary.scanned += page.length;

      const ids = [...new Set(page.map(a => a.entityId))];
      const alive = new Set(
        (await model.findMany({ where: { id: { in: ids } }, select: { id: true } }) as Array<{ id: string }>)
          .map(r => r.id),
      );

      // Group the dead ones by org — deleteAttachmentFile needs the owning
      // org's storage credentials, and one page can span several tenants.
      const byOrg = new Map<string, Array<{ id: string; provider: string; providerFileId: string }>>();
      for (const a of page) {
        if (alive.has(a.entityId)) continue;
        const orgId = a.uploader?.orgId;
        if (!orgId) continue;
        summary.orphaned++;
        const list = byOrg.get(orgId) ?? [];
        list.push({ id: a.id, provider: a.provider, providerFileId: a.providerFileId });
        byOrg.set(orgId, list);
      }

      if (!options.dryRun) {
        for (const [orgId, rows] of byOrg) {
          const dropped = await dropAttachments(orgId, rows);
          summary.deleted += dropped.deleted;
          summary.orphanedBlobs += dropped.orphanedBlobs;
        }
      }

      if (page.length < batchSize) break;
    }
  }

  return summary;
}

const REAP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Started from index.ts. First pass is delayed so it never competes with boot. */
export function startOrphanReaper() {
  const run = () => {
    reapOrphanedAttachments()
      .then(s => {
        if (s.orphaned > 0) {
          console.log(`[entityCleanup] reaped ${s.deleted}/${s.orphaned} orphaned attachments (${s.orphanedBlobs} blobs unreachable)`);
        }
      })
      .catch(err => console.error('[entityCleanup] reaper failed', err));
  };
  setTimeout(run, 5 * 60 * 1000).unref?.();
  setInterval(run, REAP_INTERVAL_MS).unref?.();
}
