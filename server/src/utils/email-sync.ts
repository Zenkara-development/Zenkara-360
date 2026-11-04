import { ImapFlow } from 'imapflow';
import { prisma } from './prisma';
import { decryptSecretOrPlain } from './crypto';

// ─── Inline types (avoids needing @types/mailparser) ─────────────────────────

interface MailAddress {
  address?: string;
  name?: string;
}
interface AddressObject {
  value: MailAddress[];
}
interface ParsedMail {
  messageId?: string;
  from?: AddressObject;
  to?: AddressObject | AddressObject[];
  subject?: string;
  text?: string;
  html?: string | boolean;
  date?: Date;
  references?: string | string[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { simpleParser } = require('mailparser') as {
  simpleParser: (src: Buffer | string) => Promise<ParsedMail>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractAddress(obj: AddressObject | AddressObject[] | undefined | null): { email: string; name: string } {
  const addr = Array.isArray(obj) ? obj[0] : obj;
  const first = addr?.value?.[0];
  return {
    email: first?.address || '',
    name: first?.name || first?.address || 'Unknown',
  };
}

/** The root thread ID for a message — first References entry, or Message-ID itself */
function getThreadId(messageId?: string | null, references?: string[] | null): string {
  if (references && references.length > 0) return references[0];
  return messageId || `thread-${Date.now()}`;
}

// ─── Per-account sync ─────────────────────────────────────────────────────────

export async function syncEmailAccount(accountId: string): Promise<{ fetched: number; errors: number }> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) return { fetched: 0, errors: 0 };

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapPort === 993,
    auth: { user: account.email, pass: decryptSecretOrPlain(account.password) },
    logger: false,
    // Certificate verification must stay ON in production: with it off, a
    // man-in-the-middle can present any certificate and harvest the tenant's
    // decrypted mailbox password. Self-signed certs are only tolerated in
    // dev/test.
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    // Without timeouts, one unresponsive IMAP server hangs this account's
    // sync forever — and since accounts sync sequentially, every OTHER
    // tenant's inbox stops updating too. Fail the account and move on.
    greetingTimeout: 30 * 1000,
    socketTimeout: 2 * 60 * 1000,
  });

  let fetched = 0;
  let errors = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Sync last 7 days on first run; otherwise since last sync
      const since = account.lastSyncAt
        ? new Date(account.lastSyncAt.getTime() - 60_000) // 1 min overlap to avoid gaps
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const uids = await client.search({ since }, { uid: true });
      if (!uids || (uids as number[]).length === 0) return { fetched: 0, errors: 0 };

      const uidList = uids as number[];

      for await (const msg of client.fetch(uidList, { source: true, uid: true }, { uid: true })) {
        try {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const messageId = parsed.messageId;
          if (!messageId) continue;

          // Skip if we already stored this message — scoped to THIS org via
          // the conversation join. Unscoped, the same Message-ID delivered
          // to mailboxes of two different tenants (a newsletter, a CC across
          // orgs) was stored only for whichever org synced first; the second
          // org silently never saw the email. Backed by the
          // messages.external_id index (see the migration of the same name)
          // so this stays O(matching ids), not a full-table scan per email.
          const exists = await prisma.message.findFirst({
            where: { externalId: messageId, conversation: { orgId: account.orgId } },
          });
          if (exists) continue;

          const from = extractAddress(parsed.from);
          const to = extractAddress(parsed.to);
          const subject = parsed.subject || '(no subject)';
          const refs = parsed.references
            ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
            : undefined;
          const threadId = getThreadId(messageId, refs);

          // Find existing conversation by threadId (within this org)
          let conversation = await prisma.conversation.findFirst({
            where: { orgId: account.orgId, externalId: threadId },
          });

          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                orgId: account.orgId,
                channel: 'EMAIL',
                contactName: from.name,
                contactEmail: from.email,
                subject,
                externalId: threadId,
                lastMessageAt: parsed.date ?? new Date(),
              },
            });
          }

          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              direction: 'INBOUND',
              fromAddress: from.email,
              toAddress: to.email || account.email,
              body: parsed.text || '',
              htmlBody: typeof parsed.html === 'string' ? parsed.html : null,
              externalId: messageId,
              sentAt: parsed.date ?? new Date(),
            },
          });

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageAt: parsed.date ?? new Date(),
              unreadCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });

          fetched++;
        } catch (msgErr: any) {
          console.warn(`[email-sync] Skipping message (parse error): ${msgErr.message}`);
          errors++;
        }
      }
    } finally {
      lock.release();
    }

    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date() },
    });
  } finally {
    try { await client.logout(); } catch { /* already disconnected */ }
  }

  return { fetched, errors };
}

// ─── Sync all orgs ────────────────────────────────────────────────────────────

// Overlap guard: the poller fires every 5 minutes regardless of whether the
// previous pass finished. One slow mailbox used to mean two (then three...)
// concurrent passes syncing the same accounts — duplicate rows and IMAP
// connection pile-up. A simple in-process flag is enough because pollers run
// in one process; cross-instance overlap is handled by the org-scoped dedupe
// above.
let syncInProgress = false;

export async function syncAllEmailAccounts(): Promise<void> {
  if (syncInProgress) {
    console.warn('[email-sync] Previous pass still running — skipping this tick');
    return;
  }
  syncInProgress = true;
  try {
    await runSyncPass();
  } finally {
    syncInProgress = false;
  }
}

async function runSyncPass(): Promise<void> {
  const accounts = await prisma.emailAccount.findMany({ select: { id: true, email: true } });
  if (accounts.length === 0) return;

  console.log(`[email-sync] Syncing ${accounts.length} account(s)…`);
  for (const acc of accounts) {
    try {
      const result = await syncEmailAccount(acc.id);
      if (result.fetched > 0) {
        console.log(`[email-sync] ${acc.email}: +${result.fetched} messages`);
      }
    } catch (err: any) {
      console.error(`[email-sync] ${acc.email} failed: ${err.message}`);
    }
  }
}
