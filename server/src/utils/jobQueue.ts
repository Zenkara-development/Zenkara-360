import { prisma } from './prisma';

/**
 * Postgres-backed retry queue for at-least-once background delivery. This
 * exists to close a specific reliability gap: mailer.ts / slack.ts /
 * teams.ts / webPush.ts all previously did `.catch(err => console.error(...))`
 * on delivery failure — a transient SMTP timeout, a rate-limited Slack
 * webhook, a flaky push endpoint meant the message was just gone, logged to
 * a console nobody watches, with no retry and no visibility. This gives
 * those failures a second (and third, and fourth...) chance, and a place
 * (the admin "Failed Jobs" panel) where a permanently-failed send is
 * actually visible instead of silently dropped.
 *
 * Deliberately a DB-polled queue, not Redis/BullMQ — see scheduler.ts's doc
 * comment for why this app sticks to plain setInterval + DB polling (single
 * Node process today, no infra beyond Postgres on the deploy target). This
 * poller follows the exact same shape as startSchedulePoller() etc.
 */

export type JobType = 'send_email' | 'slack_webhook' | 'teams_webhook' | 'web_push';

export type JobHandler = (payload: any) => Promise<void>;

const handlers = new Map<JobType, JobHandler>();

/** Registered once per job type, at module-load time, by the utility that owns that delivery channel (mailer.ts, slack.ts, teams.ts, webPush.ts). */
export function registerJobHandler(type: JobType, handler: JobHandler): void {
  handlers.set(type, handler);
}

const DEFAULT_MAX_ATTEMPTS = 6;

/**
 * How long a claimed (PROCESSING) job may run before another poller may
 * assume its owner died and reclaim it. Claiming a job (see processDueJobs)
 * pushes its nextAttemptAt this far into the future, which doubles as the
 * stall marker — no schema change needed. Must comfortably exceed the
 * slowest legitimate handler (an SMTP send with retries takes seconds, not
 * minutes).
 */
const STALL_TIMEOUT_MS = 10 * 60 * 1000;

/** Exponential backoff, capped at 30 minutes: 30s, 60s, 2m, 4m, 8m, 16m, ... */
function backoffMs(attempt: number): number {
  return Math.min(30 * 60 * 1000, Math.pow(2, attempt) * 15 * 1000);
}

/** Enqueues a job for background delivery. Never throws — a failure to enqueue shouldn't take down the caller; it's logged and the send is simply lost, same as the old behavior it's replacing. */
export async function enqueueJob(
  type: JobType,
  payload: unknown,
  opts?: { orgId?: string | null; maxAttempts?: number },
): Promise<void> {
  try {
    await prisma.backgroundJob.create({
      data: {
        type,
        payload: payload as any,
        orgId: opts?.orgId ?? null,
        maxAttempts: opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[jobQueue] Failed to enqueue "${type}" job:`, err);
  }
}

/** Processes every due job (status PENDING, nextAttemptAt in the past), one at a time. Exported for the admin "Retry now" action to await a single pass after resetting a job. */
export async function processDueJobs(limit = 25): Promise<void> {
  const due = await prisma.backgroundJob.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  for (const job of due) {
    const handler = handlers.get(job.type as JobType);
    if (!handler) {
      // No handler registered for this type — nothing will ever process it.
      // Mark it failed immediately rather than leaving it stuck PENDING forever.
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', lastError: `No handler registered for job type "${job.type}"` },
      }).catch(() => {});
      continue;
    }

    // ATOMIC claim: only flip PENDING → PROCESSING if it's still PENDING.
    // The previous find-then-update pair was a race — two pollers (the old
    // and new instance during a zero-downtime deploy, or two scaled
    // instances) could both pick up the same job and both send the email.
    // updateMany with the status in the WHERE makes the DB the referee:
    // exactly one claimer sees count === 1. The claim also pushes
    // nextAttemptAt out by STALL_TIMEOUT_MS as the stall marker.
    const claimed = await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'PROCESSING', nextAttemptAt: new Date(Date.now() + STALL_TIMEOUT_MS) },
    }).catch(() => ({ count: 0 }));
    if (claimed.count === 0) continue; // another instance got there first

    try {
      await handler(job.payload);
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } catch (err: any) {
      const attempts = job.attempts + 1;
      const isFinal = attempts >= job.maxAttempts;
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          attempts,
          status: isFinal ? 'FAILED' : 'PENDING',
          nextAttemptAt: isFinal ? job.nextAttemptAt : new Date(Date.now() + backoffMs(attempts)),
          lastError: String(err?.message || err).slice(0, 2000),
        },
      }).catch(() => {});
    }
  }
}

/** Resets a FAILED (or stuck) job back to PENDING for immediate reprocessing — used by the admin "Retry" button. */
export async function retryJob(jobId: string, orgId?: string): Promise<boolean> {
  const where: any = { id: jobId };
  if (orgId) where.orgId = orgId;
  const result = await prisma.backgroundJob.updateMany({
    where,
    data: { status: 'PENDING', nextAttemptAt: new Date(), lastError: null },
  });
  return result.count > 0;
}

/**
 * Returns rows stranded in PROCESSING back to PENDING.
 *
 * A crash, an OOM kill or a SIGTERM mid-handler leaves the row PROCESSING;
 * nothing polls for that status, so without recovery the send is silently
 * lost. It counts as an attempt, so a job that reliably crashes the process
 * still exhausts maxAttempts instead of looping forever.
 *
 * TIME-BASED, not boot-time-sweep: recovery only touches PROCESSING rows
 * whose nextAttemptAt (set to claim-time + STALL_TIMEOUT_MS by the atomic
 * claim above) is in the past. The old version swept EVERY PROCESSING row at
 * boot on the assumption the app is single-process — but Render's
 * zero-downtime deploys run the old and new instance concurrently, so the
 * new instance's sweep was requeueing jobs the old instance was actively
 * executing → duplicate delivery on every deploy. A time-based cutoff makes
 * recovery safe to run at boot AND periodically, on any number of instances.
 */
export async function recoverStalledJobs(): Promise<number> {
  try {
    const stalled = await prisma.backgroundJob.findMany({
      where: { status: 'PROCESSING', nextAttemptAt: { lte: new Date() } },
      select: { id: true, attempts: true, maxAttempts: true },
    });
    if (!stalled.length) return 0;

    await Promise.all(stalled.map(j => {
      const attempts = j.attempts + 1;
      const isFinal = attempts >= j.maxAttempts;
      return prisma.backgroundJob.update({
        where: { id: j.id },
        data: {
          attempts,
          status: isFinal ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(),
          lastError: isFinal
            ? 'Interrupted by a server restart, and out of retries'
            : 'Interrupted by a server restart — requeued',
        },
      }).catch(() => {});
    }));

    console.log(`[jobQueue] Recovered ${stalled.length} job(s) stranded in PROCESSING`);
    return stalled.length;
  } catch (err: any) {
    console.error('[jobQueue] Stalled-job recovery failed:', err?.message || err);
    return 0;
  }
}

/** Check for due jobs every 15 seconds — frequent enough that a retried send doesn't sit around for long, cheap enough that it's a non-issue for a single Postgres instance. */
export function startJobQueuePoller(): void {
  // Recovery + first poll at boot (recovery is now time-based, so this is
  // safe even while the previous instance is still draining), then recovery
  // rides along with every poll — a stalled job is picked up within one
  // STALL_TIMEOUT_MS + 15s window without waiting for the next restart.
  recoverStalledJobs()
    .then(() => processDueJobs())
    .catch(err => console.error('[jobQueue] Startup pass failed:', err));

  setInterval(() => {
    recoverStalledJobs()
      .then(() => processDueJobs())
      .catch(err => console.error('[jobQueue] Poll error:', err));
  }, 15 * 1000);
}
