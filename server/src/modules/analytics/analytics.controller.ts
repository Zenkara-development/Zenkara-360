import { Response, NextFunction } from 'express';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateLabel(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Build a series of N days leading up to today with zeroed counts
function buildDaySeries(days: number): Record<string, number> {
  const series: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    series[dateLabel(daysAgo(i))] = 0;
  }
  return series;
}

// Simple linear regression forecast
function linearForecast(series: number[], futureDays: number): number[] {
  const n = series.length;
  if (n < 2) return Array(futureDays).fill(series[0] ?? 0);
  const xs = series.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = series.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - meanX) * (series[i] - meanY), 0)
               / xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const intercept = meanY - slope * meanX;
  return Array.from({ length: futureDays }, (_, i) =>
    Math.max(0, Math.round(intercept + slope * (n + i)))
  );
}

// ─── GET /api/analytics/tickets ──────────────────────────────────────────────

export async function ticketAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const days = parseInt(req.query.days as string) || 30;
    const since = daysAgo(days);

    // Daily ticket creation volume
    const created = await prisma.ticket.findMany({
      where: { orgId, createdAt: { gte: since } },
      select: { createdAt: true, status: true, priority: true, resolvedAt: true, slaDueAt: true },
    });

    const volumeSeries = buildDaySeries(days);
    const resolvedSeries = buildDaySeries(days);
    created.forEach(t => {
      const day = dateLabel(t.createdAt);
      if (day in volumeSeries) volumeSeries[day]++;
      if (t.resolvedAt) {
        const rDay = dateLabel(t.resolvedAt);
        if (rDay in resolvedSeries) resolvedSeries[rDay]++;
      }
    });

    const volumeArr = Object.values(volumeSeries);
    const forecast = linearForecast(volumeArr, 7);

    // Status & priority breakdown
    const byStatus = await prisma.ticket.groupBy({ by: ['status'], _count: true, where: { orgId } });
    const byPriority = await prisma.ticket.groupBy({ by: ['priority'], _count: true, where: { orgId } });

    // Average resolution time (hours)
    const resolvedTickets = created.filter(t => t.resolvedAt);
    const avgResolutionHours = resolvedTickets.length > 0
      ? Math.round(resolvedTickets.reduce((s, t) => s + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3600000, 0) / resolvedTickets.length)
      : null;

    // SLA compliance
    const slaTickets = created.filter(t => t.slaDueAt);
    const slaBreached = slaTickets.filter(t => t.resolvedAt ? t.resolvedAt > t.slaDueAt! : new Date() > t.slaDueAt!);
    const slaCompliance = slaTickets.length > 0
      ? Math.round(((slaTickets.length - slaBreached.length) / slaTickets.length) * 100)
      : null;

    // Category breakdown
    const byCategory = await prisma.ticket.groupBy({ by: ['categoryId'], _count: true, where: { orgId, createdAt: { gte: since } } });
    const categoryIds = byCategory.map(c => c.categoryId).filter(Boolean) as string[];
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } });
    const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

    res.json({
      volume: {
        labels: Object.keys(volumeSeries),
        created: volumeArr,
        resolved: Object.values(resolvedSeries),
        forecast,
      },
      byStatus: byStatus.map(s => ({ status: s.status, count: s._count })),
      byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count })),
      byCategory: byCategory.map(c => ({ category: c.categoryId ? catMap[c.categoryId] || 'Uncategorised' : 'Uncategorised', count: c._count })),
      avgResolutionHours,
      slaCompliance,
    });
  } catch (err) { next(err); }
}

// ─── GET /api/analytics/crm ───────────────────────────────────────────────────

export async function crmAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const days = parseInt(req.query.days as string) || 30;
    const since = daysAgo(days);

    // Lead status funnel
    const leads = await prisma.lead.groupBy({ by: ['status'], _count: true, where: { orgId } });
    const leadsOverTime = buildDaySeries(days);
    const recentLeads = await prisma.lead.findMany({ where: { orgId, createdAt: { gte: since } }, select: { createdAt: true } });
    recentLeads.forEach(l => { const d = dateLabel(l.createdAt); if (d in leadsOverTime) leadsOverTime[d]++; });

    // Deal pipeline
    const deals = await prisma.deal.findMany({ where: { orgId, status: 'OPEN' }, select: { stage: true, value: true } });
    const pipeline = deals.reduce((acc, d) => {
      acc[d.stage] = acc[d.stage] || { stage: d.stage, count: 0, value: 0 };
      acc[d.stage].count++;
      acc[d.stage].value += Number(d.value);
      return acc;
    }, {} as Record<string, { stage: string; count: number; value: number }>);

    // Win/loss rate
    const won = await prisma.deal.count({ where: { orgId, status: 'WON', updatedAt: { gte: since } } });
    const lost = await prisma.deal.count({ where: { orgId, status: 'LOST', updatedAt: { gte: since } } });
    const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : null;

    // Revenue from won deals over time
    const wonDeals = await prisma.deal.findMany({
      where: { orgId, status: 'WON', updatedAt: { gte: since } },
      select: { updatedAt: true, value: true },
    });
    const revenueSeries = buildDaySeries(days);
    wonDeals.forEach(d => { const day = dateLabel(d.updatedAt); if (day in revenueSeries) revenueSeries[day] += Number(d.value); });

    // Conversion rate (leads converted vs. total)
    const totalLeads = await prisma.lead.count({ where: { orgId } });
    const convertedLeads = await prisma.lead.count({ where: { orgId, status: 'CONVERTED' } });
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    res.json({
      leads: {
        byStatus: leads.map(l => ({ status: l.status, count: l._count })),
        overTime: { labels: Object.keys(leadsOverTime), values: Object.values(leadsOverTime) },
        conversionRate,
      },
      deals: {
        pipeline: Object.values(pipeline),
        winRate,
        revenue: { labels: Object.keys(revenueSeries), values: Object.values(revenueSeries) },
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /api/analytics/overview ─────────────────────────────────────────────

export async function overview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const last30 = daysAgo(30);
    const last60 = daysAgo(60);

    const [
      ticketsOpen, ticketsOpenPrev,
      leadsNew, leadsNewPrev,
      dealsWon, dealsWonPrev,
      avgResRaw
    ] = await Promise.all([
      prisma.ticket.count({ where: { orgId, status: { in: ['OPEN','IN_PROGRESS'] }, createdAt: { gte: last30 } } }),
      prisma.ticket.count({ where: { orgId, status: { in: ['OPEN','IN_PROGRESS'] }, createdAt: { gte: last60, lt: last30 } } }),
      prisma.lead.count({ where: { orgId, createdAt: { gte: last30 } } }),
      prisma.lead.count({ where: { orgId, createdAt: { gte: last60, lt: last30 } } }),
      prisma.deal.aggregate({ _sum: { value: true }, where: { orgId, status: 'WON', updatedAt: { gte: last30 } } }),
      prisma.deal.aggregate({ _sum: { value: true }, where: { orgId, status: 'WON', updatedAt: { gte: last60, lt: last30 } } }),
      prisma.ticket.findMany({ where: { orgId, resolvedAt: { gte: last30, not: null } }, select: { createdAt: true, resolvedAt: true } }),
    ]);

    const avgResolutionHours = avgResRaw.length > 0
      ? Math.round(avgResRaw.reduce((s, t) => s + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3600000, 0) / avgResRaw.length)
      : null;

    function pctChange(cur: number, prev: number) {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return Math.round(((cur - prev) / prev) * 100);
    }

    res.json({
      tickets: { current: ticketsOpen, change: pctChange(ticketsOpen, ticketsOpenPrev) },
      leads: { current: leadsNew, change: pctChange(leadsNew, leadsNewPrev) },
      revenue: {
        current: Number(dealsWon._sum.value || 0),
        change: pctChange(Number(dealsWon._sum.value || 0), Number(dealsWonPrev._sum.value || 0))
      },
      avgResolutionHours,
    });
  } catch (err) { next(err); }
}
