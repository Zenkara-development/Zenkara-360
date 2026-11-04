import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

const ENTITY_TYPES = ['TICKET', 'CONTACT', 'DEAL', 'LEAD'] as const;

const RecordTemplateSchema = z.object({
  entityType:        z.enum(ENTITY_TYPES),
  name:               z.string().min(1).max(100),
  description:        z.string().max(500).optional().nullable(),
  fieldValues:        z.record(z.string(), z.any()).default({}),
  customFieldValues:  z.record(z.string(), z.any()).optional().nullable(),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType } = req.query as { entityType?: string };
    const where: any = { orgId: req.user!.orgId };
    if (entityType) where.entityType = entityType;
    const templates = await prisma.recordTemplate.findMany({
      where, orderBy: [{ entityType: 'asc' }, { name: 'asc' }],
    });
    res.json({ data: templates });
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const template = await prisma.recordTemplate.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!template) throw new AppError(404, 'Template not found');
    res.json(template);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = RecordTemplateSchema.parse(req.body);
    const template = await prisma.recordTemplate.create({
      data: { ...data, orgId, customFieldValues: data.customFieldValues ?? undefined },
    });
    res.status(201).json(template);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = RecordTemplateSchema.partial().omit({ entityType: true }).parse(req.body);
    const template = await prisma.recordTemplate.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!template) throw new AppError(404, 'Template not found');
    const updated = await prisma.recordTemplate.update({
      where: { id: req.params.id },
      data: { ...data, customFieldValues: data.customFieldValues ?? undefined },
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.recordTemplate.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Template deleted' });
  } catch (err) { next(err); }
}
