import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { parsePagination, paginate } from '../../utils/pagination';
import { purgeEntityChildren } from '../../utils/entityCleanup';

const Schema = z.object({
  title:        z.string().min(1),
  description:  z.string().min(1),
  type:         z.enum(['NORMAL', 'EMERGENCY', 'STANDARD']).default('NORMAL'),
  priority:     z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  assignedTo:   z.string().optional().nullable(),
  plannedStart: z.string().optional().nullable(),
  plannedEnd:   z.string().optional().nullable(),
});

const include = {
  requester: { select: { id: true, name: true, email: true } },
  assignee:  { select: { id: true, name: true, email: true } },
};

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { status, priority, type } = req.query as Record<string, string>;
    const where: any = { orgId };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type) where.type = type;

    const pag = parsePagination(req);
    const [data, total] = await Promise.all([
      prisma.changeRequest.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.changeRequest.count({ where }),
    ]);
    res.json(paginate(data, total, pag));
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = Schema.parse(req.body);
    const cr = await prisma.changeRequest.create({
      data: {
        ...data,
        orgId,
        requestedBy: req.user!.id,
        assignedTo: data.assignedTo ?? undefined,
        plannedStart: data.plannedStart ? new Date(data.plannedStart) : undefined,
        plannedEnd: data.plannedEnd ? new Date(data.plannedEnd) : undefined,
      },
      include,
    });
    res.status(201).json(cr);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cr = await prisma.changeRequest.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include,
    });
    if (!cr) throw new AppError(404, 'Change request not found');
    res.json(cr);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    await prisma.changeRequest.updateMany({
      where: { id: req.params.id, orgId: req.user!.orgId },
      data: {
        ...data,
        assignedTo: data.assignedTo ?? undefined,
        plannedStart: data.plannedStart ? new Date(data.plannedStart) : data.plannedStart === null ? null : undefined,
        plannedEnd: data.plannedEnd ? new Date(data.plannedEnd) : data.plannedEnd === null ? null : undefined,
      },
    });
    const cr = await prisma.changeRequest.findUnique({ where: { id: req.params.id }, include });
    res.json(cr);
  } catch (err) { next(err); }
}

export async function approve(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cr = await prisma.changeRequest.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!cr) throw new AppError(404, 'Change request not found');
    if (!['SUBMITTED'].includes(cr.status)) throw new AppError(400, `Cannot approve from status: ${cr.status}`);

    const updated = await prisma.changeRequest.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', approvedBy: req.user!.id, approvedAt: new Date() },
      include,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function reject(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const cr = await prisma.changeRequest.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!cr) throw new AppError(404, 'Change request not found');
    if (!['SUBMITTED'].includes(cr.status)) throw new AppError(400, `Cannot reject from status: ${cr.status}`);

    const updated = await prisma.changeRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectedBy: req.user!.id, rejectionReason: reason },
      include,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function changeStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = z.object({
      status: z.enum(['DRAFT', 'SUBMITTED', 'IMPLEMENTING', 'DONE']),
    }).parse(req.body);

    const cr = await prisma.changeRequest.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!cr) throw new AppError(404, 'Change request not found');

    const updated = await prisma.changeRequest.update({ where: { id: req.params.id }, data: { status }, include });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.changeRequest.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('CHANGE_REQUEST', req.params.id, req.user!.orgId);
    res.json({ message: 'Change request deleted' });
  } catch (err) { next(err); }
}
