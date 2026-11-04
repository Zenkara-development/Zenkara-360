import https from 'https';
import { URL } from 'url';
import { prisma } from './prisma';
import { enqueueJob, registerJobHandler } from './jobQueue';

// ─── Teams uses "Adaptive Cards" via incoming webhook ─────────────────────────

export async function postToTeams(webhookUrl: string, payload: object): Promise<void> {
  const body = JSON.stringify(payload);
  const parsed = new URL(webhookUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode < 300) resolve();
          else reject(new Error(`Teams webhook error ${res.statusCode}: ${data}`));
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Sends now; on failure, queues a retry instead of just logging and dropping the alert — see slack.ts's postToSlackWithRetry for the identical rationale. */
async function postToTeamsWithRetry(webhookUrl: string, payload: object, orgId?: string): Promise<void> {
  try {
    await postToTeams(webhookUrl, payload);
  } catch (err: any) {
    console.error('[teams] send error — queuing retry:', err.message);
    await enqueueJob('teams_webhook', { webhookUrl, payload }, { orgId: orgId ?? null });
  }
}

registerJobHandler('teams_webhook', async (data: { webhookUrl: string; payload: object }) => {
  await postToTeams(data.webhookUrl, data.payload);
});

// ─── Teams Adaptive Card builder ─────────────────────────────────────────────

function teamCard(title: string, color: string, facts: { name: string; value: string }[]) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: title, color: color === 'red' ? 'Attention' : color === 'green' ? 'Good' : color === 'yellow' ? 'Warning' : 'Default' },
          { type: 'FactSet', facts },
        ],
      },
    }],
  };
}

const PRIORITY_COLOR: Record<string, string> = { CRITICAL: 'red', HIGH: 'warning', MEDIUM: 'default', LOW: 'green' };

export async function teamsNewTicket(orgId: string, ticket: { id: string; title: string; priority: string; requester?: { name: string } | null }) {
  const cfg = await prisma.teamsConfig.findUnique({ where: { orgId } });
  if (!cfg || !cfg.notifyOnNewTicket) return;
  if (ticket.priority === 'CRITICAL' && !cfg.notifyOnCritical) return;

  await postToTeamsWithRetry(cfg.webhookUrl, teamCard(
    `🎫 New ${ticket.priority} Ticket`,
    PRIORITY_COLOR[ticket.priority] ?? 'default',
    [
      { name: 'Title', value: ticket.title },
      { name: 'Priority', value: ticket.priority },
      { name: 'From', value: ticket.requester?.name ?? 'Unknown' },
    ],
  ), orgId);
}

export async function teamsSlaBreached(orgId: string, ticket: { title: string; priority: string; slaDueAt: Date | null }) {
  const cfg = await prisma.teamsConfig.findUnique({ where: { orgId } });
  if (!cfg || !cfg.notifyOnSlaBreached) return;

  await postToTeamsWithRetry(cfg.webhookUrl, teamCard(
    '⏰ SLA Breached',
    'red',
    [
      { name: 'Ticket', value: ticket.title },
      { name: 'Priority', value: ticket.priority },
      { name: 'Due was', value: ticket.slaDueAt?.toISOString() ?? 'N/A' },
    ],
  ), orgId);
}

export async function teamsDealWon(orgId: string, deal: { title: string; value: number | string; assignee?: { name: string } | null }) {
  const cfg = await prisma.teamsConfig.findUnique({ where: { orgId } });
  if (!cfg || !cfg.notifyOnDealWon) return;

  await postToTeamsWithRetry(cfg.webhookUrl, teamCard(
    `🏆 Deal Won: ${deal.title}`,
    'green',
    [
      { name: 'Deal', value: deal.title },
      { name: 'Value', value: `$${Number(deal.value).toLocaleString()}` },
      { name: 'Closed by', value: deal.assignee?.name ?? 'Unknown' },
    ],
  ), orgId);
}

export async function teamsNewLead(orgId: string, lead: { id: string; contact?: { name: string; email?: string | null } | null; source?: string | null }) {
  const cfg = await prisma.teamsConfig.findUnique({ where: { orgId } });
  if (!cfg || !cfg.notifyOnNewLead) return;

  await postToTeamsWithRetry(cfg.webhookUrl, teamCard(
    '🎯 New Lead Captured',
    'default',
    [
      { name: 'Name', value: lead.contact?.name ?? 'Unknown' },
      { name: 'Email', value: lead.contact?.email ?? '—' },
      { name: 'Source', value: lead.source ?? '—' },
    ],
  ), orgId);
}
