import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { assertEntityInOrg, ENTITY_MODEL } from '../../utils/entityAccess';
import { logAction } from '../../utils/auditLog';

/**
 * Tags, on any record.
 *
 * There has been a `Tag` table since the first release, plus `contact_tags`
 * and `deal_tags` to hang tags off those two models. Nothing ever read them:
 * no `/api/tags` route existed, no component rendered a tag, and the only
 * writer in the entire codebase was the demo seed. The AI's `TAG` action, not
 * having anywhere to put a tag, wrote the tag name into a comment body
 * instead — which is why "tagged as Churn Risk" showed up as a note rather
 * than something you could filter on.
 *
 * This replaces both join tables with one polymorphic `RecordTag`, matching
 * the entityType/entityId pattern that Comments, Attachments and Tasks
 * already use, so a tag works the same on a ticket as on a deal.
 *
 * Two rules worth stating, because they are what stops tags turning into
 * free-text noise:
 *
 *  1. Tag names are unique per org, case-insensitively. "VIP", "vip" and
 *     "Vip" are one tag. Without this every user invents their own casing
 *     and filtering by tag stops working within a month.
 *  2. Attaching a tag that does not exist creates it (`findOrCreate` inside
 *     attach). That is deliberate — a tag input that makes you visit a
 *     settings screen first does not get used — but it is also why `create`
 *     is a separate, deliberate endpoint with a colour.
 */

const NAME_MAX = 40;

const CreateTagSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #6366F1').optional(),
  module: z.string().max(30).optional(),
});

const UpdateTagSchema = CreateTagSchema.partial();

const AttachSchema = z.object({
  /** Existing tag. Either this or `name`. */
  tagId: z.string().optional(),
  /** Tag name — created if it does not exist yet. */
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).refine(v => !!(v.tagId || v.name), { message: 'Provide either tagId or name' });

/** Colours new tags cycle through, so an auto-created tag is never grey-on-grey. */
const PALETTE = ['#6366F1', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#0EA5E9', '#EC4899', '#84CC16'];

function pickColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function assertKnownEntityType(entityType: string): void {
  if (!ENTITY_MODEL[entityType]) {
    throw new AppError(400, `Unknown record type "${entityType}"`);
  }
}

/**
 * Resolves a tag by id or by name, creating it when only a name was given.
 *
 * The case-insensitive lookup happens before the create so that "vip" finds
 * the existing "VIP" rather than colliding on the unique index — and the
 * create is wrapped because two people tagging the same record at the same
 * moment would otherwise race each other to P2002.
 */
async function resolveTag(
  orgId: string,
  input: { tagId?: string; name?: string; color?: string },
): Promise<{ id: string; name: string; color: string; module: string }> {
  if (input.tagId) {
    const tag = await prisma.tag.findFirst({ where: { id: input.tagId, orgId } });
    if (!tag) throw new AppError(404, 'Tag not found');
    return tag;
  }

  const name = input.name!.trim();
  const existing = await prisma.tag.findFirst({
    where: { orgId, name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) return existing;

  try {
    return await prisma.tag.create({
      data: { orgId, name, color: input.color ?? pickColor(name), module: 'ALL' },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Lost the race; the other request created it a millisecond ago.
      const now = await prisma.tag.findFirst({
        where: { orgId, name: { equals: name, mode: 'insensitive' } },
      });
      if (now) return now;
    }
    throw err;
  }
}

// ─── Tag library ──────────────────────────────────────────────────────────────

/** Every tag in the org, with how many records currently carry it. */
export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { search, module } = req.query as Record<string, string>;

    const tags = await prisma.tag.findMany({
      where: {
        orgId,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        // module is a grouping hint, not a restriction — 'ALL' tags always show.
        ...(module && module !== 'ALL' ? { OR: [{ module }, { module: 'ALL' }] } : {}),
      },
      include: { _count: { select: { records: true } } },
      orderBy: { name: 'asc' },
    });

    res.json({
      data: tags.map(t => ({
        id: t.id, name: t.name, color: t.color, module: t.module, usageCount: t._count.records,
      })),
      total: tags.length,
    });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = CreateTagSchema.parse(req.body);

    const clash = await prisma.tag.findFirst({
      where: { orgId, name: { equals: data.name, mode: 'insensitive' } },
    });
    if (clash) throw new AppError(409, `A tag called "${clash.name}" already exists.`);

    const tag = await prisma.tag.create({
      data: { orgId, name: data.name, color: data.color ?? pickColor(data.name), module: data.module ?? 'ALL' },
    });
    logAction(req.user!.id, 'CREATE', 'Tag', tag.id, { name: tag.name });
    res.status(201).json(tag);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const existing = await prisma.tag.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Tag not found');

    const data = UpdateTagSchema.parse(req.body);
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await prisma.tag.findFirst({
        where: { orgId, name: { equals: data.name, mode: 'insensitive' }, id: { not: existing.id } },
      });
      if (clash) throw new AppError(409, `A tag called "${clash.name}" already exists.`);
    }

    // Renaming updates every record at once — that is the point of a tag
    // table rather than a string column, and worth an audit entry.
    const tag = await prisma.tag.update({ where: { id: existing.id }, data });
    logAction(req.user!.id, 'UPDATE', 'Tag', tag.id, { from: existing.name, to: tag.name });
    res.json(tag);
  } catch (err) { next(err); }
}

/** Deletes a tag everywhere. RecordTag rows cascade at the database level. */
export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const existing = await prisma.tag.findFirst({
      where: { id: req.params.id, orgId },
      include: { _count: { select: { records: true } } },
    });
    if (!existing) throw new AppError(404, 'Tag not found');

    // Deleting a tag that is in use removes it from every one of those
    // records. Requiring ?force=true means nobody does that by misclick from
    // the tag manager, where the usage count is right there on screen.
    if (existing._count.records > 0 && req.query.force !== 'true') {
      throw new AppError(
        409,
        `"${existing.name}" is on ${existing._count.records} record(s). Deleting it removes it from all of them.`,
      );
    }

    await prisma.tag.delete({ where: { id: existing.id } });
    logAction(req.user!.id, 'DELETE', 'Tag', existing.id, { name: existing.name, records: existing._count.records });
    res.json({ message: 'Deleted', removedFrom: existing._count.records });
  } catch (err) { next(err); }
}

/** Merges `sourceId` into `targetId` — the fix for "VIP" vs "V.I.P.". */
export async function merge(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { sourceId, targetId } = z.object({ sourceId: z.string(), targetId: z.string() }).parse(req.body);
    if (sourceId === targetId) throw new AppError(400, 'Pick two different tags');

    const [source, target] = await Promise.all([
      prisma.tag.findFirst({ where: { id: sourceId, orgId } }),
      prisma.tag.findFirst({ where: { id: targetId, orgId } }),
    ]);
    if (!source || !target) throw new AppError(404, 'Tag not found');

    const links = await prisma.recordTag.findMany({
      where: { orgId, tagId: source.id },
      select: { entityType: true, entityId: true },
    });

    // createMany + skipDuplicates rather than updateMany: a record carrying
    // both tags already would violate the unique index on a straight update.
    if (links.length) {
      await prisma.recordTag.createMany({
        data: links.map(l => ({
          orgId, tagId: target.id, entityType: l.entityType, entityId: l.entityId, createdById: req.user!.id,
        })),
        skipDuplicates: true,
      });
    }
    await prisma.tag.delete({ where: { id: source.id } });

    logAction(req.user!.id, 'UPDATE', 'Tag', target.id, { merged: source.name, into: target.name, records: links.length });
    res.json({ message: `Merged "${source.name}" into "${target.name}"`, movedRecords: links.length });
  } catch (err) { next(err); }
}

// ─── Tags on a record ─────────────────────────────────────────────────────────

export async function listForRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId } = req.params;
    assertKnownEntityType(entityType);
    await assertEntityInOrg(entityType, entityId, req.user!.orgId);

    const rows = await prisma.recordTag.findMany({
      where: { orgId: req.user!.orgId, entityType: entityType as any, entityId },
      include: { tag: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json(rows.map(r => ({
      id: r.tag.id, name: r.tag.name, color: r.tag.color, appliedAt: r.createdAt,
    })));
  } catch (err) { next(err); }
}

export async function attach(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId } = req.params;
    const orgId = req.user!.orgId;
    assertKnownEntityType(entityType);
    await assertEntityInOrg(entityType, entityId, orgId);

    const input = AttachSchema.parse(req.body);
    const tag = await resolveTag(orgId, input);

    // Tagging something already tagged is a success, not a 409 — the caller
    // wanted the tag on the record and it is.
    await prisma.recordTag.upsert({
      where: { tagId_entityType_entityId: { tagId: tag.id, entityType: entityType as any, entityId } },
      create: { orgId, tagId: tag.id, entityType: entityType as any, entityId, createdById: req.user!.id },
      update: {},
    });

    res.status(201).json({ id: tag.id, name: tag.name, color: tag.color });
  } catch (err) { next(err); }
}

export async function detach(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId, tagId } = req.params;
    const orgId = req.user!.orgId;
    assertKnownEntityType(entityType);
    await assertEntityInOrg(entityType, entityId, orgId);

    await prisma.recordTag.deleteMany({
      where: { orgId, tagId, entityType: entityType as any, entityId },
    });
    res.json({ message: 'Removed' });
  } catch (err) { next(err); }
}

/**
 * Which records carry a tag, grouped by type.
 *
 * Returns ids and types only. Resolving each id to a title would mean a query
 * per entity type on every call; the client already knows how to route to a
 * record from its type and id, and the list views do the filtering by passing
 * `?tagId=` to their own endpoints.
 */
export async function records(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const tag = await prisma.tag.findFirst({ where: { id: req.params.id, orgId } });
    if (!tag) throw new AppError(404, 'Tag not found');

    const rows = await prisma.recordTag.findMany({
      where: { orgId, tagId: tag.id },
      select: { entityType: true, entityId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const byType: Record<string, string[]> = {};
    for (const r of rows) (byType[r.entityType] ??= []).push(r.entityId);

    res.json({ tag: { id: tag.id, name: tag.name, color: tag.color }, total: rows.length, byType });
  } catch (err) { next(err); }
}
