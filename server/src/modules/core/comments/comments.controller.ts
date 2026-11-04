import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { sanitizeRichText } from '../../../utils/sanitizeHtml';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { assertEntityInOrg } from '../../../utils/entityAccess';

const include = { author: { select: { id: true, name: true, avatarUrl: true } } };

// Comment is a polymorphic model (entityType + entityId) with no orgId
// column of its own — every entry point below confirms the underlying
// entity is in-org before touching its comments (assertEntityInOrg,
// utils/entityAccess.ts — shared with the Attachments module so both stay
// in sync on which entity types are supported).

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId } = req.params;
    await assertEntityInOrg(entityType, entityId, req.user!.orgId);
    const comments = await prisma.comment.findMany({
      where: { entityType: entityType as any, entityId },
      include,
      orderBy: { createdAt: 'asc' },
    });
    res.json(comments);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId } = req.params;
    await assertEntityInOrg(entityType, entityId, req.user!.orgId);
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    const comment = await prisma.comment.create({
      data: { entityType: entityType as any, entityId, body: sanitizeRichText(body), authorId: req.user!.id },
      include,
    });
    res.status(201).json(comment);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!comment) throw new AppError(404, 'Comment not found');
    await assertEntityInOrg(comment.entityType, comment.entityId, req.user!.orgId);
    if (comment.authorId !== req.user!.id) throw new AppError(403, 'Not your comment');
    const updated = await prisma.comment.update({ where: { id: req.params.id }, data: { body: sanitizeRichText(body) }, include });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!comment) throw new AppError(404, 'Comment not found');
    await assertEntityInOrg(comment.entityType, comment.entityId, req.user!.orgId);
    if (comment.authorId !== req.user!.id && req.user!.role !== 'SUPER_ADMIN') throw new AppError(403, 'Not allowed');
    await prisma.comment.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
