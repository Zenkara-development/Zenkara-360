import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

const CreateSchema = z.object({
  entityType: z.enum(['TICKET', 'DEAL']),
  entityId: z.string().min(1),
  // Accepts whatever an <input type="datetime-local"> / Date#toISOString() sends.
  dueAt: z.string().min(1),
  recurrence: z.enum(['NONE', 'DAILY', 'WEEKLY']).default('NONE'),
  message: z.string().min(1).max(1000),
  recipientType: z.enum(['CONTACT', 'ASSIGNEE', 'CUSTOM_NUMBER', 'ORG_DEFAULT']),
  customNumber: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { entityType, entityId } = req.query as Record<string, string>;
    const where: any = { orgId };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    const schedules = await prisma.schedule.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      include: { creator: { select: { id: true, name: true } } },
    });
    res.json(schedules);
  } catch (err) { next(err); }
}

/** Org-wide upcoming reminders, for a dashboard widget — not scoped to one record. */
export async function listUpcoming(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const schedules = await prisma.schedule.findMany({
      where: { orgId, status: 'PENDING' },
      orderBy: { dueAt: 'asc' },
      take: 20,
    });
    res.json(schedules);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = CreateSchema.parse(req.body);

    if (data.recipientType === 'CUSTOM_NUMBER' && !data.customNumber) {
      throw new AppError(400, 'A phone number is required when the recipient is "Custom number"');
    }
    if (data.recipientType === 'CONTACT' && data.entityType !== 'DEAL') {
      throw new AppError(400, 'Only deals have a linked contact — choose a different recipient for tickets');
    }

    // Confirm the target record actually exists in this org before
    // scheduling against it, so a stale/mistyped id doesn't silently create
    // a reminder that can never resolve a recipient.
    const exists = data.entityType === 'TICKET'
      ? await prisma.ticket.findFirst({ where: { id: data.entityId, orgId }, select: { id: true } })
      : await prisma.deal.findFirst({ where: { id: data.entityId, orgId }, select: { id: true } });
    if (!exists) throw new AppError(404, `${data.entityType === 'TICKET' ? 'Ticket' : 'Deal'} not found`);

    const schedule = await prisma.schedule.create({
      data: {
        orgId,
        entityType: data.entityType,
        entityId: data.entityId,
        dueAt: new Date(data.dueAt),
        recurrence: data.recurrence,
        message: data.message,
        recipientType: data.recipientType,
        customNumber: data.customNumber || null,
        createdBy: req.user!.id,
      },
      include: { creator: { select: { id: true, name: true } } },
    });
    res.status(201).json(schedule);
  } catch (err) { next(err); }
}

/** Cancels (deletes) a reminder — pending or already sent, either way it drops off the list. */
export async function cancel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { count } = await prisma.schedule.deleteMany({ where: { id: req.params.id, orgId } });
    if (count === 0) throw new AppError(404, 'Schedule not found');
    res.json({ message: 'Reminder cancelled' });
  } catch (err) { next(err); }
}
