import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { parsePagination, paginate } from '../../../utils/pagination';
import { purgeEntityChildren } from '../../../utils/entityCleanup';

const Schema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const include = { owner: { select: { id: true, name: true } }, _count: { select: { contacts: true, deals: true } } };

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search } = req.query as Record<string, string>;
    const pag = parsePagination(req);
    const where: any = { orgId: req.user!.orgId };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [accounts, total] = await Promise.all([
      prisma.account.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.account.count({ where }),
    ]);
    res.json(paginate(accounts, total, pag));
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.parse(req.body);
    const account = await prisma.account.create({ data: { ...data, orgId: req.user!.orgId, ownerId: req.user!.id }, include });
    res.status(201).json(account);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: { owner: { select: { id: true, name: true } }, contacts: true, deals: { include: { assignee: { select: { id: true, name: true } } } } }
    });
    if (!account) throw new AppError(404, 'Account not found');
    res.json(account);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    await prisma.account.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId }, data });
    const account = await prisma.account.findUnique({ where: { id: req.params.id }, include });
    res.json(account);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.account.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('ACCOUNT', req.params.id, req.user!.orgId);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
