import { Response, NextFunction } from 'express';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { retryJob, processDueJobs } from '../../utils/jobQueue';

/**
 * Admin-facing visibility into the background job queue (utils/jobQueue.ts)
 * — the whole point of moving fire-and-forget sends onto a retry queue is
 * lost if a permanently-failed send is just as invisible as the old
 * console.error was. This is where an admin actually sees it and can retry.
 */

const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

export async function listJobs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const status = req.query.status as string | undefined;
    const where: any = { orgId };
    if (status) {
      if (!STATUSES.includes(status as any)) throw new AppError(400, `Invalid status filter — must be one of ${STATUSES.join(', ')}`);
      where.status = status;
    }

    const [jobs, counts] = await Promise.all([
      prisma.backgroundJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.backgroundJob.groupBy({
        by: ['status'],
        where: { orgId },
        _count: { _all: true },
      }),
    ]);

    const summary: Record<string, number> = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
    for (const c of counts) summary[c.status] = c._count._all;

    res.json({ data: jobs, summary });
  } catch (err) { next(err); }
}

/** Resets a job to PENDING and immediately runs one processing pass, so the admin sees the outcome right away instead of waiting up to 15s for the next poll. */
export async function retryJobNow(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ok = await retryJob(req.params.id, orgId);
    if (!ok) throw new AppError(404, 'Job not found');

    await processDueJobs();

    const job = await prisma.backgroundJob.findFirst({ where: { id: req.params.id, orgId } });
    res.json(job);
  } catch (err) { next(err); }
}
