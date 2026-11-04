import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';

const Schema = z.object({
  name: z.string().min(1),
  parentId: z.string().optional(),
  slaPolicyId: z.string().optional(),
  autoAssignGroup: z.string().optional(),
});

const include = { slaPolicy: { select: { id: true, name: true } }, _count: { select: { tickets: true } } };

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const categories = await prisma.category.findMany({ where: { orgId: req.user!.orgId }, include, orderBy: { name: 'asc' } });
    res.json(categories);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.parse(req.body);
    const category = await prisma.category.create({ data: { ...data, orgId: req.user!.orgId }, include });
    res.status(201).json(category);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    await prisma.category.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId }, data });
    const category = await prisma.category.findUnique({ where: { id: req.params.id }, include });
    res.json(category);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.category.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
