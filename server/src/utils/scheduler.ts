import { prisma } from './prisma';
import { sendWhatsApp } from './whatsapp';
import { resolveRecipientPhone } from './notification-recipient';

const POLL_INTERVAL_MS = 60 * 1000;

/** Resolves {{title}} in a reminder message against the linked ticket/deal. */
async function resolveMessage(entityType: string, entityId: string, message: string): Promise<string> {
  if (!message.includes('{{')) return message;
  const record = entityType === 'TICKET'
    ? await prisma.ticket.findUnique({ where: { id: entityId }, select: { title: true } })
    : await prisma.deal.findUnique({ where: { id: entityId }, select: { title: true } });
  return message.replace(/\{\{title\}\}/g, record?.title ?? '');
}

/**
 * The next occurrence strictly in the future.
 *
 * This used to add exactly one day/week to the OLD dueAt and stop. After any
 * downtime that skipped occurrences, the catch-up run therefore produced a
 * dueAt that was still in the past, so the next poll fired it again — a
 * reminder that missed three days replayed three times in three consecutive
 * minutes instead of resuming its schedule. Advancing until we pass `from`
 * means a missed reminder sends once and then resumes normally.
 */
function nextOccurrence(dueAt: Date, recurrence: string, from: Date = new Date()): Date | null {
  const stepDays = recurrence === 'DAILY' ? 1 : recurrence === 'WEEKLY' ? 7 : 0;
  if (!stepDays) return null; // 'NONE'

  const next = new Date(dueAt);
  // Bounded so a long-dormant weekly reminder cannot spin here.
  for (let i = 0; i < 5000 && next <= from; i++) next.setDate(next.getDate() + stepDays);
  return next;
}

/**
 * Checks for due Schedule rows and sends their WhatsApp reminder. Run on a
 * plain setInterval rather than a job queue (BullMQ/Redis etc.) — this app
 * runs as a single Node process today, so a periodic DB poll is the
 * pragmatic fit; swap this out if the app ever needs multi-instance
 * reliability guarantees.
 */
export async function checkDueSchedules(): Promise<void> {
  const due = await prisma.schedule.findMany({
    where: { status: 'PENDING', dueAt: { lte: new Date() } },
  });

  for (const schedule of due) {
    try {
      const phone = await resolveRecipientPhone({
        orgId: schedule.orgId,
        entityType: schedule.entityType as 'TICKET' | 'DEAL',
        entityId: schedule.entityId,
        recipientType: schedule.recipientType as any,
        customNumber: schedule.customNumber,
      });
      const message = await resolveMessage(schedule.entityType, schedule.entityId, schedule.message);

      /* Advance the row BEFORE sending.
         The send used to come first, so if sendWhatsApp succeeded but the
         following update failed, the row stayed PENDING at its old dueAt and
         the reminder went out again every 60 seconds, indefinitely. Moving
         the clock first turns that failure mode into at-most-once instead of
         unbounded — the safer direction for something that messages
         customers. A crash between the two now costs one missed reminder,
         recorded below, rather than an endless loop. */
      const next = nextOccurrence(schedule.dueAt, schedule.recurrence);
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: next
          ? { dueAt: next, sentAt: new Date(), lastError: null } // stays PENDING for its next occurrence
          : { status: 'SENT', sentAt: new Date(), lastError: null },
      });

      await sendWhatsApp(schedule.orgId, phone, message);
    } catch (err: any) {
      // Marked FAILED (not left PENDING) so a persistently broken config
      // (no WhatsApp connected, assignee has no phone, etc.) doesn't retry
      // every single minute forever — the error is visible on the record
      // for someone to fix and re-schedule.
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: { status: 'FAILED', lastError: String(err?.message || err) },
      }).catch(() => {});
      console.error(`[scheduler] Failed to send reminder ${schedule.id}:`, err?.message || err);
    }
  }
}

export function startSchedulePoller() {
  checkDueSchedules().catch(() => {});
  setInterval(() => checkDueSchedules().catch(() => {}), POLL_INTERVAL_MS);
}
