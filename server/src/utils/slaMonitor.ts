import { prisma } from './prisma';
import { runWorkflows } from './workflow-engine';
import { slackSlaBreached } from './slack';
import { teamsSlaBreached } from './teams';
import { createNotification } from '../modules/notifications/notifications.controller';

/**
 * Detects tickets that have crossed their SLA resolution deadline
 * (Ticket.slaDueAt, computed from SlaPolicy.resolutionHours at ticket
 * creation — see tickets.controller.ts's calcSlaDue) while still open, and
 * fires every SLA-breach notification channel that already existed in the
 * codebase but was never actually wired to anything: the workflow engine's
 * SLA_BREACH trigger (any org's user-configured rule), plus Slack and Teams
 * (both already gated by their own per-org notifyOnSlaBreached toggle —
 * slackSlaBreached()/teamsSlaBreached() just needed a caller). Also directly
 * notifies (in-app + push) SlaPolicy.notifyUserId, if the policy that
 * governs this ticket's category has one configured — see the "Notify"
 * field on the SLA Policy form (CategoriesPage.tsx). That's independent of
 * the workflow trigger: an org can use one, the other, both, or neither.
 *
 * The SlaBreaches table (schema.prisma) already existed for this too, but
 * nothing ever wrote to it — it's used here as both the audit trail and the
 * dedup marker: once a RESOLUTION breach row exists for a ticket, it's
 * never reprocessed, no matter how long the ticket stays open.
 *
 * Same in-process setInterval poller shape as scheduler.ts/dateAutomation.ts.
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000; // SLA is time-sensitive; hourly would let a breach sit unnoticed too long

export async function checkSlaBreaches(): Promise<void> {
  const breached = await prisma.ticket.findMany({
    where: {
      slaDueAt: { lt: new Date() },
      status: { notIn: ['RESOLVED', 'CLOSED'] },
      breaches: { none: { breachType: 'RESOLUTION' } },
    },
    include: { category: { include: { slaPolicy: { select: { notifyUserId: true } } } } },
  });

  for (const ticket of breached) {
    try {
      // Record the breach first — if a notification channel below throws,
      // we still don't want to re-fire on the next poll for this ticket.
      await prisma.slaBreaches.create({ data: { ticketId: ticket.id, breachType: 'RESOLUTION' } });

      await runWorkflows({
        trigger: 'SLA_BREACH',
        orgId: ticket.orgId,
        entityType: 'TICKET',
        entityId: ticket.id,
        entity: ticket as unknown as Record<string, any>,
      });
      await slackSlaBreached(ticket.orgId, ticket);
      await teamsSlaBreached(ticket.orgId, ticket);

      const notifyUserId = ticket.category?.slaPolicy?.notifyUserId;
      if (notifyUserId) {
        await createNotification({
          orgId: ticket.orgId,
          userId: notifyUserId,
          type: 'TICKET_SLA_BREACH', // matching "TICKET" is what NotificationBell.tsx's icon heuristic keys off of
          title: `SLA breached: ${ticket.title}`,
          body: `This ticket's resolution deadline was ${ticket.slaDueAt?.toLocaleString() ?? 'due'}.`,
          entityType: 'TICKET',
          entityId: ticket.id,
        });
      }
    } catch (err: any) {
      console.error(`[sla-monitor] Failed processing ticket ${ticket.id}:`, err?.message || err);
    }
  }
}

export function startSlaMonitorPoller() {
  checkSlaBreaches().catch(() => {});
  setInterval(() => checkSlaBreaches().catch(() => {}), POLL_INTERVAL_MS);
}
