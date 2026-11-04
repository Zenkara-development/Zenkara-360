import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

const ReplyTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const templates = await prisma.replyTemplate.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { name: 'asc' },
    });
    res.json({ data: templates });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = ReplyTemplateSchema.parse(req.body);
    const template = await prisma.replyTemplate.create({ data: { ...data, orgId } });
    res.status(201).json(template);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ReplyTemplateSchema.partial().parse(req.body);
    const template = await prisma.replyTemplate.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!template) throw new AppError(404, 'Template not found');
    const updated = await prisma.replyTemplate.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.replyTemplate.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Template deleted' });
  } catch (err) { next(err); }
}
