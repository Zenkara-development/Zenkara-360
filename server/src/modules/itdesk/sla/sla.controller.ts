import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';

const Schema = z.object({
  name: z.string().min(1),
  responseHours: z.number().int().min(1),
  resolutionHours: z.number().int().min(1),
  priorityOverrides: z.any().optional(),
  // Who to notify (in-app + push, see utils/slaMonitor.ts) when a ticket
  // under this policy breaches. Maps '' to an explicit null (not undefined)
  // so submitting the form with "— none —" selected actually clears a
  // previously-set recipient — Prisma treats undefined as "don't touch",
  // which would make that impossible. Omitting the field entirely (partial
  // update, field never sent) still correctly leaves it untouched, since
  // .partial() lets the key itself be absent from the parsed output.
  notifyUserId: z.string().optional().or(z.literal('')).transform(v => v || null),
});

const include = { notifyUser: { select: { id: true, name: true } } };

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const policies = await prisma.slaPolicy.findMany({ where: { orgId: req.user!.orgId }, include, orderBy: { name: 'asc' } });
    res.json(policies);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.parse(req.body);
    const policy = await prisma.slaPolicy.create({ data: { ...data, orgId: req.user!.orgId }, include });
    res.status(201).json(policy);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    await prisma.slaPolicy.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId }, data });
    const policy = await prisma.slaPolicy.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include });
    res.json(policy);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.slaPolicy.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
