import { Response, NextFunction } from 'express';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';

function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

export async function ticketReports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const last30 = subDays(new Date(), 30);

    const tickets = await prisma.ticket.findMany({
      where: { orgId, createdAt: { gte: last30 } },
      select: { createdAt: true, status: true, priority: true, resolvedAt: true, slaDueAt: true },
    });

    const volumeMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const key = subDays(new Date(), i).toISOString().slice(0, 10);
      volumeMap[key] = 0;
    }
    tickets.forEach(t => {
      const key = t.createdAt.toISOString().slice(0, 10);
      if (volumeMap[key] !== undefined) volumeMap[key]++;
    });
    const volume = Object.entries(volumeMap).map(([date, count]) => ({ date, count }));

    const resolved = tickets.filter(t => t.resolvedAt);
    const resolutionByPriority: Record<string, { total: number; count: number }> = {
      LOW: { total: 0, count: 0 }, MEDIUM: { total: 0, count: 0 },
      HIGH: { total: 0, count: 0 }, CRITICAL: { total: 0, count: 0 },
    };
    resolved.forEach(t => {
      if (t.resolvedAt) {
        const hours = (t.resolvedAt.getTime() - t.createdAt.getTime()) / 3600000;
        resolutionByPriority[t.priority].total += hours;
        resolutionByPriority[t.priority].count++;
      }
    });
    const resolutionTime = Object.entries(resolutionByPriority).map(([priority, { total, count }]) => ({
      priority,
      avgHours: count > 0 ? Math.round(total / count) : 0,
    }));

    const totalClosed = await prisma.ticket.count({ where: { orgId, status: { in: ['RESOLVED', 'CLOSED'] } } });
    const slaBreached = await prisma.ticket.count({
      where: { orgId, status: { in: ['RESOLVED', 'CLOSED'] }, resolvedAt: { not: null }, slaDueAt: { not: null } },
    });
    const slaCompliance = totalClosed > 0 ? Math.round(((totalClosed - slaBreached) / totalClosed) * 100) : 100;

    const statusBreakdown = await prisma.ticket.groupBy({ by: ['status'], _count: true, where: { orgId } });

    res.json({ volume, resolutionTime, slaCompliance, statusBreakdown });
  } catch (err) { next(err); }
}

export async function crmReports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const last30 = subDays(new Date(), 30);

    const deals = await prisma.deal.findMany({
      where: { orgId, createdAt: { gte: last30 } },
      select: { createdAt: true, value: true, status: true, stage: true, probability: true },
    });

    const dealVolumeMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const key = subDays(new Date(), i).toISOString().slice(0, 10);
      dealVolumeMap[key] = 0;
    }
    deals.forEach(d => {
      const key = d.createdAt.toISOString().slice(0, 10);
      if (dealVolumeMap[key] !== undefined) dealVolumeMap[key]++;
    });
    const dealVolume = Object.entries(dealVolumeMap).map(([date, count]) => ({ date, count }));

    const pipeline = await prisma.pipeline.findFirst({ where: { orgId, isDefault: true } });
    const stages = (pipeline?.stages as string[]) || [];
    const openDeals = await prisma.deal.findMany({ where: { orgId, status: 'OPEN' } });
    const forecastByStage = stages.map(stage => {
      const stageDeals = openDeals.filter(d => d.stage === stage);
      const weighted = stageDeals.reduce((s, d) => s + (Number(d.value) * d.probability / 100), 0);
      const total = stageDeals.reduce((s, d) => s + Number(d.value), 0);
      return { stage, weighted: Math.round(weighted), total: Math.round(total), count: stageDeals.length };
    });

    const won = await prisma.deal.count({ where: { orgId, status: 'WON' } });
    const lost = await prisma.deal.count({ where: { orgId, status: 'LOST' } });
    const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;

    const topContacts = await prisma.contact.findMany({
      where: { orgId },
      include: { deals: { where: { orgId, status: 'OPEN' }, select: { value: true } } },
      take: 5,
    });
    const contactsByValue = topContacts
      .map(c => ({ name: c.name, value: c.deals.reduce((s, d) => s + Number(d.value), 0) }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value);

    res.json({ dealVolume, forecastByStage, won, lost, winRate, contactsByValue });
  } catch (err) { next(err); }
}
