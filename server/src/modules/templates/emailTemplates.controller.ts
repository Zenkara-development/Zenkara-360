import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

const EmailTemplateSchema = z.object({
  name:    z.string().min(1).max(100),
  subject: z.string().min(1),
  body:    z.string().min(1),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const templates = await prisma.emailTemplate.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { name: 'asc' },
    });
    res.json({ data: templates });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = EmailTemplateSchema.parse(req.body);
    const template = await prisma.emailTemplate.create({ data: { ...data, orgId } });
    res.status(201).json(template);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = EmailTemplateSchema.partial().parse(req.body);
    const template = await prisma.emailTemplate.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!template) throw new AppError(404, 'Template not found');
    const updated = await prisma.emailTemplate.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.emailTemplate.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Template deleted' });
  } catch (err) { next(err); }
}
