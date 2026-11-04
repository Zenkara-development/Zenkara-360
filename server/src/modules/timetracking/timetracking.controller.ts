import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

const Schema = z.object({
  description: z.string().optional(),
  minutes:     z.number().int().min(1).max(1440),
  loggedAt:    z.string().optional(),
});

export async function listEntries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { ticketId } = req.params;
    const entries = await prisma.timeEntry.findMany({
      where: { ticketId, orgId: req.user!.orgId },
      orderBy: { loggedAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    res.json({ entries, totalMinutes });
  } catch (err) { next(err); }
}

export async function logTime(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { ticketId } = req.params;
    const orgId = req.user!.orgId;

    const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, orgId } });
    if (!ticket) throw new AppError(404, 'Ticket not found');

    const data = Schema.parse(req.body);
    const entry = await prisma.timeEntry.create({
      data: {
        orgId,
        ticketId,
        userId: req.user!.id,
        description: data.description,
        minutes: data.minutes,
        loggedAt: data.loggedAt ? new Date(data.loggedAt) : new Date(),
      },
      include: { user: { select: { id: true, name: true } } },
    });
    res.status(201).json(entry);
  } catch (err) { next(err); }
}

export async function deleteEntry(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const deleted = await prisma.timeEntry.deleteMany({
      where: { id: req.params.entryId, orgId: req.user!.orgId },
    });
    if (!deleted.count) throw new AppError(404, 'Time entry not found');
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
