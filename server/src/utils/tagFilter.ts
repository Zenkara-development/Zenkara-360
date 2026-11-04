import { prisma } from './prisma';

/**
 * Turns `?tagId=…` on a list endpoint into a `where` clause fragment.
 *
 * Tags live in `record_tags` keyed by entityType + entityId rather than as a
 * relation on each model, so `where: { tags: { some: … } }` is not available —
 * that is the trade for one tag system instead of thirteen join tables. Two
 * queries is the cost, and the `[orgId, tagId]` index makes the first one an
 * index-only scan.
 *
 * Multiple tags are AND-ed (a record must carry all of them), because that is
 * what someone filtering by "VIP" and "Churn Risk" together means. Pass a
 * comma-separated list to do that.
 *
 * Returns `null` when no tag filter was requested, so callers can skip it
 * entirely rather than merging an empty clause.
 */
export async function tagIdFilter(
  orgId: string,
  entityType: string,
  tagIdParam?: string,
): Promise<{ id: { in: string[] } } | null> {
  const tagIds = (tagIdParam ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (tagIds.length === 0) return null;

  const rows = await prisma.recordTag.findMany({
    where: { orgId, entityType: entityType as any, tagId: { in: tagIds } },
    select: { entityId: true, tagId: true },
  });

  if (tagIds.length === 1) {
    return { id: { in: [...new Set(rows.map(r => r.entityId))] } };
  }

  // AND across tags: keep only the records that matched every requested tag.
  const hits = new Map<string, Set<string>>();
  for (const r of rows) {
    (hits.get(r.entityId) ?? hits.set(r.entityId, new Set()).get(r.entityId)!).add(r.tagId);
  }
  const matching = [...hits.entries()]
    .filter(([, tags]) => tags.size === new Set(tagIds).size)
    .map(([id]) => id);

  return { id: { in: matching } };
}
