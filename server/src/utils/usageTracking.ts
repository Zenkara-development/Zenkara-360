import { prisma } from './prisma';

// No billing decisions read from this yet — it exists purely to collect real
// usage data (AI calls, WhatsApp sends, email sends) per org so
// included-quota/overage numbers can be set from actual patterns instead of
// guessed. See server/prisma/schema.prisma's UsageEvent model for the
// storage shape.

export type UsageEventType = 'AI_CALL' | 'WHATSAPP_SEND' | 'EMAIL_SEND';
export type UsageEventSource = 'OWN' | 'PLATFORM';

/**
 * Fire-and-forget — usage logging must never be the reason a real request
 * (an AI call the user is waiting on, a WhatsApp send a workflow depends on)
 * fails. Errors are swallowed and logged, same pattern as sendMail().
 *
 * `source` is only meaningful for WHATSAPP_SEND/EMAIL_SEND — pass 'OWN' when
 * the org's own connected account was used, 'PLATFORM' when it went out
 * through the platform's shared fallback (see utils/whatsapp.ts, utils/mailer.ts).
 */
export function recordUsage(orgId: string, type: UsageEventType, source?: UsageEventSource): void {
  prisma.usageEvent.create({ data: { orgId, type, source } }).catch((err: unknown) => {
    console.error('[Usage tracking error]', type, orgId, err);
  });
}

export interface UsageSummary {
  aiCalls: number;
  whatsappSends: number;
  periodStart: string;
  periodEnd: string;
}

/** Usage counts for the org's current calendar month — the natural period
 * to eventually line up with monthly billing cycles. */
export async function getUsageSummary(orgId: string): Promise<UsageSummary> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [aiCalls, whatsappSends] = await Promise.all([
    prisma.usageEvent.count({ where: { orgId, type: 'AI_CALL', createdAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.usageEvent.count({ where: { orgId, type: 'WHATSAPP_SEND', createdAt: { gte: periodStart, lt: periodEnd } } }),
  ]);

  return { aiCalls, whatsappSends, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() };
}

export interface SendCounts {
  email: { own: number; platform: number; total: number };
  whatsapp: { own: number; platform: number; total: number };
}

const emptySendCounts = (): SendCounts => ({
  email: { own: 0, platform: 0, total: 0 },
  whatsapp: { own: 0, platform: 0, total: 0 },
});

/** Rows predate the `source` column, or a caller didn't pass one — those are
 * always the org's own account (PLATFORM is only ever set explicitly by the
 * fallback paths), so null buckets into 'own'. */
function bucketFor(counts: SendCounts, type: string, source: string | null, n: number) {
  const bucket = type === 'EMAIL_SEND' ? counts.email : type === 'WHATSAPP_SEND' ? counts.whatsapp : null;
  if (!bucket) return;
  if (source === 'PLATFORM') bucket.platform += n; else bucket.own += n;
  bucket.total += n;
}

/** All-time email/WhatsApp send counts for one org, split by own-account vs.
 * platform-fallback — used by the Platform Admin console's org detail panel. */
export async function getSendCounts(orgId: string): Promise<SendCounts> {
  const rows = await prisma.usageEvent.groupBy({
    by: ['type', 'source'],
    where: { orgId, type: { in: ['EMAIL_SEND', 'WHATSAPP_SEND'] } },
    _count: { _all: true },
  });
  const counts = emptySendCounts();
  for (const r of rows) bucketFor(counts, r.type, r.source, r._count._all);
  return counts;
}

/** Same as getSendCounts, batched across every org in one query — used by the
 * Platform Admin console's org list so it doesn't run N+1 groupBy queries. */
export async function getSendCountsForOrgs(orgIds: string[]): Promise<Record<string, SendCounts>> {
  if (orgIds.length === 0) return {};
  const rows = await prisma.usageEvent.groupBy({
    by: ['orgId', 'type', 'source'],
    where: { orgId: { in: orgIds }, type: { in: ['EMAIL_SEND', 'WHATSAPP_SEND'] } },
    _count: { _all: true },
  });
  const result: Record<string, SendCounts> = {};
  for (const id of orgIds) result[id] = emptySendCounts();
  for (const r of rows) bucketFor(result[r.orgId], r.type, r.source, r._count._all);
  return result;
}
