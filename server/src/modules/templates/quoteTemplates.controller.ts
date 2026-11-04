import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

const LineSchema = z.object({
  description: z.string().min(1),
  quantity:    z.coerce.number().positive().default(1),
  unitPrice:   z.coerce.number().min(0),
  discount:    z.coerce.number().min(0).max(100).default(0),
});

const QuoteTemplateSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  lines:       z.array(LineSchema).min(1),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const templates = await prisma.quoteTemplate.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { name: 'asc' },
    });
    res.json({ data: templates });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = QuoteTemplateSchema.parse(req.body);
    const template = await prisma.quoteTemplate.create({ data: { ...data, orgId } });
    res.status(201).json(template);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = QuoteTemplateSchema.partial().parse(req.body);
    const template = await prisma.quoteTemplate.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!template) throw new AppError(404, 'Template not found');
    const updated = await prisma.quoteTemplate.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.quoteTemplate.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Template deleted' });
  } catch (err) { next(err); }
}
