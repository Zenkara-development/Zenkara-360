import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { parsePagination, paginate } from '../../../utils/pagination';
import { purgeEntityChildren } from '../../../utils/entityCleanup';

const Schema = z.object({
  name:         z.string().min(1),
  type:         z.string().min(1),
  serialNumber: z.string().optional(),
  assignedTo:   z.string().optional().nullable(),
  status:       z.enum(['active', 'inactive', 'retired', 'in_repair']).default('active'),
  purchaseDate: z.string().optional().nullable(),
});

const include = {
  assignee: { select: { id: true, name: true, email: true } },
};

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { type, status, assignedTo, search } = req.query as Record<string, string>;
    const where: any = { orgId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (assignedTo) where.assignedTo = assignedTo;
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
      { type: { contains: search, mode: 'insensitive' } },
    ];

    const pag = parsePagination(req);
    const [assets, total] = await Promise.all([
      prisma.asset.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.asset.count({ where }),
    ]);
    res.json(paginate(assets, total, pag));
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = Schema.parse(req.body);
    const asset = await prisma.asset.create({
      data: {
        ...data,
        orgId,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        assignedTo: data.assignedTo ?? undefined,
      },
      include,
    });
    res.status(201).json(asset);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: {
        ...include,
        tickets: { include: { ticket: { select: { id: true, title: true, status: true, priority: true } } } },
      },
    });
    if (!asset) throw new AppError(404, 'Asset not found');
    res.json(asset);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    await prisma.asset.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId }, data: {
      ...data,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : data.purchaseDate === null ? null : undefined,
      assignedTo: data.assignedTo ?? undefined,
    }});
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id }, include });
    res.json(asset);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.asset.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('ASSET', req.params.id, req.user!.orgId);
    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
}

export async function stats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const [total, active, retired, inRepair, byType] = await Promise.all([
      prisma.asset.count({ where: { orgId } }),
      prisma.asset.count({ where: { orgId, status: 'active' } }),
      prisma.asset.count({ where: { orgId, status: 'retired' } }),
      prisma.asset.count({ where: { orgId, status: 'in_repair' } }),
      prisma.asset.groupBy({ by: ['type'], _count: true, where: { orgId } }),
    ]);
    res.json({ total, active, retired, inRepair, byType });
  } catch (err) { next(err); }
}
