import { Response, NextFunction, Request } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import https from 'https';
import nodemailer from 'nodemailer';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { syncEmailAccount } from '../../utils/email-sync';
import { sseManager, SSEEvent } from '../../utils/sse';
import { encryptSecret, decryptSecretOrPlain } from '../../utils/crypto';
import { recordUsage } from '../../utils/usageTracking';

// ─── Twilio REST helper (no SDK — direct HTTPS call) ──────────────────────────

async function sendTwilioMessage(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string,
): Promise<{ sid: string }> {
  const params = new URLSearchParams({ From: from, To: to, Body: body }).toString();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new AppError(res.statusCode, json.message || 'Twilio error'));
            } else {
              resolve({ sid: json.sid });
            }
          } catch {
            reject(new Error('Invalid Twilio response'));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(params);
    req.end();
  });
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function listConversations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const channel = req.query.channel as string | undefined;
    const status = (req.query.status as string) || 'OPEN';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 30);

    const where: any = { orgId };
    if (channel && ['EMAIL', 'WHATSAPP', 'CHAT'].includes(channel)) where.channel = channel;
    if (status !== 'ALL') where.status = status;

    const [total, conversations] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          messages: { orderBy: { sentAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    res.json({ data: conversations, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
}

export async function getConversation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId },
      include: {
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        messages: { orderBy: { sentAt: 'asc' } },
      },
    });
    if (!conversation) throw new AppError(404, 'Conversation not found');

    // Mark all inbound messages as read
    await prisma.message.updateMany({
      where: { conversationId: id, direction: 'INBOUND', readAt: null },
      data: { readAt: new Date() },
    });
    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });

    res.json(conversation);
  } catch (err) { next(err); }
}

export async function updateConversation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;
    const data = z.object({
      status: z.enum(['OPEN', 'CLOSED', 'PENDING']).optional(),
      assignedTo: z.string().nullable().optional(),
    }).parse(req.body);

    const conversation = await prisma.conversation.findFirst({ where: { id, orgId } });
    if (!conversation) throw new AppError(404, 'Conversation not found');

    const updated = await prisma.conversation.update({ where: { id }, data });
    res.json(updated);
  } catch (err) { next(err); }
}

// ─── Reply ────────────────────────────────────────────────────────────────────

export async function sendReply(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;
    const { body } = z.object({ body: z.string().min(1).max(4000) }).parse(req.body);

    const conversation = await prisma.conversation.findFirst({ where: { id, orgId } });
    if (!conversation) throw new AppError(404, 'Conversation not found');

    let outboundId: string | undefined;
    let fromAddress = '';

    if (conversation.channel === 'EMAIL') {
      const emailAccount = await prisma.emailAccount.findUnique({ where: { orgId } });
      if (!emailAccount) throw new AppError(400, 'No email account connected. Go to Inbox → Settings.');

      fromAddress = emailAccount.email;
      const transport = nodemailer.createTransport({
        host: emailAccount.smtpHost,
        port: emailAccount.smtpPort,
        secure: emailAccount.smtpPort === 465,
        auth: { user: emailAccount.email, pass: decryptSecretOrPlain(emailAccount.password) },
      });

      const info = await transport.sendMail({
        from: emailAccount.email,
        to: conversation.contactEmail ?? '',
        subject: `Re: ${conversation.subject || '(no subject)'}`,
        text: body,
        headers: conversation.externalId
          ? { 'In-Reply-To': conversation.externalId, References: conversation.externalId }
          : {},
      });
      outboundId = info.messageId;
      recordUsage(orgId, 'EMAIL_SEND', 'OWN');
    } else if (conversation.channel === 'WHATSAPP') {
      const waConfig = await prisma.whatsAppConfig.findUnique({ where: { orgId } });
      if (!waConfig) throw new AppError(400, 'No WhatsApp account connected. Go to Inbox → Settings.');

      fromAddress = waConfig.phoneNumber;
      const toNumber = conversation.contactPhone?.startsWith('whatsapp:')
        ? conversation.contactPhone
        : `whatsapp:${conversation.contactPhone}`;
      const fromNumber = waConfig.phoneNumber.startsWith('whatsapp:')
        ? waConfig.phoneNumber
        : `whatsapp:${waConfig.phoneNumber}`;

      const result = await sendTwilioMessage(
        waConfig.accountSid,
        waConfig.authToken,
        fromNumber,
        toNumber,
        body,
      );
      outboundId = result.sid;
      recordUsage(orgId, 'WHATSAPP_SEND', 'OWN');
    } else if (conversation.channel === 'CHAT') {
      // Live chat from the customer portal — no external transport, the
      // message just needs to land in the Message table; the portal side
      // picks it up on its next poll (see portal.controller.ts getChatMessages).
      fromAddress = 'staff';
    } else {
      throw new AppError(400, 'Unknown channel');
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: 'OUTBOUND',
        fromAddress,
        toAddress: conversation.contactEmail || conversation.contactPhone || '',
        body,
        externalId: outboundId,
        sentAt: new Date(),
        readAt: new Date(), // outbound messages are implicitly read
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });

    sseManager.broadcastAll(orgId, SSEEvent.INBOX_MESSAGE, { conversationId: id, messageId: message.id, direction: 'OUTBOUND' });
    res.json(message);
  } catch (err) { next(err); }
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const [emailAccount, whatsAppConfig] = await Promise.all([
      prisma.emailAccount.findUnique({
        where: { orgId },
        select: { id: true, email: true, imapHost: true, imapPort: true, smtpHost: true, smtpPort: true, lastSyncAt: true },
      }),
      prisma.whatsAppConfig.findUnique({
        where: { orgId },
        select: { id: true, accountSid: true, phoneNumber: true, notifyNumber: true },
      }),
    ]);
    res.json({ emailAccount, whatsAppConfig });
  } catch (err) { next(err); }
}

const EmailAccountSchema = z.object({
  email: z.string().email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535).default(993),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  password: z.string().min(1),
});

export async function connectEmail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = EmailAccountSchema.parse(req.body);
    // Encrypt before persisting — this column previously stored the raw
    // IMAP/SMTP password in plain text.
    const encrypted = { ...data, password: encryptSecret(data.password) };

    const account = await prisma.emailAccount.upsert({
      where: { orgId },
      create: { orgId, ...encrypted },
      update: encrypted,
      select: { id: true, email: true, imapHost: true, imapPort: true, smtpHost: true, smtpPort: true },
    });

    // Kick off an initial sync in the background
    syncEmailAccount(account.id).catch((err) =>
      console.error('[email-sync] Initial sync failed:', err.message),
    );

    res.json({ message: 'Email account connected. Initial sync started.', account });
  } catch (err) { next(err); }
}

export async function disconnectEmail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await prisma.emailAccount.deleteMany({ where: { orgId } });
    res.json({ message: 'Email account disconnected' });
  } catch (err) { next(err); }
}

const WhatsAppConfigSchema = z.object({
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  phoneNumber: z.string().min(1),
  // Optional destination for "ORG_DEFAULT"-recipient Schedule/workflow
  // notifications (deal/ticket reminders etc.) — separate from phoneNumber,
  // which is the org's outbound sender number for customer conversations.
  notifyNumber: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
});

export async function connectWhatsApp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = WhatsAppConfigSchema.parse(req.body);

    const config = await prisma.whatsAppConfig.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
      select: { id: true, accountSid: true, phoneNumber: true, notifyNumber: true },
    });

    res.json({ message: 'WhatsApp connected', config });
  } catch (err) { next(err); }
}

export async function disconnectWhatsApp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await prisma.whatsAppConfig.deleteMany({ where: { orgId } });
    res.json({ message: 'WhatsApp disconnected' });
  } catch (err) { next(err); }
}

// ─── Manual sync trigger ──────────────────────────────────────────────────────

export async function triggerSync(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const account = await prisma.emailAccount.findUnique({ where: { orgId } });
    if (!account) throw new AppError(400, 'No email account connected');

    // Run sync in background
    syncEmailAccount(account.id)
      .then((r) => console.log(`[email-sync] Manual sync: +${r.fetched} messages`))
      .catch((err) => console.error('[email-sync] Manual sync error:', err.message));

    res.json({ message: 'Sync started' });
  } catch (err) { next(err); }
}

/**
 * Twilio's request signature: HMAC-SHA1 over the full request URL with every
 * POST parameter appended in alphabetical order, keyed by the account's auth
 * token, base64-encoded.
 * https://www.twilio.com/docs/usage/security#validating-signatures
 *
 * Implemented here rather than pulled from the `twilio` SDK because
 * utils/whatsapp.ts already speaks to Twilio over plain HTTPS instead of the
 * SDK, and this keeps that consistent.
 */
function isValidTwilioSignature(signature: string, req: Request, authToken: string): boolean {
  try {
    // Behind Render/Netlify the request is proxied, so trust the forwarded
    // headers when present — otherwise the URL we hash differs from the one
    // Twilio signed and every request looks forged.
    const proto = (req.header('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    const host = (req.header('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    const url = `${proto}://${host}${req.originalUrl}`;

    const params = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const data = Object.keys(params).sort().reduce((acc, k) => acc + k + String(params[k] ?? ''), url);

    const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    // Length check first: timingSafeEqual throws on a length mismatch.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Twilio Webhook (no JWT auth — Twilio calls this) ─────────────────────────

export async function twilioWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    // Twilio sends URL-encoded form data
    const from: string = req.body.From || '';       // e.g. whatsapp:+1234567890
    const to: string = req.body.To || '';           // e.g. whatsapp:+14155238886
    const body: string = req.body.Body || '';
    const messageSid: string = req.body.MessageSid || '';

    if (!from || !body) {
      return res.status(200).send('<Response></Response>');
    }

    // Find which org owns this WhatsApp number
    const normalizedTo = to.replace('whatsapp:', '');
    const waConfig = await prisma.whatsAppConfig.findFirst({
      where: {
        OR: [
          { phoneNumber: to },
          { phoneNumber: normalizedTo },
          { phoneNumber: `whatsapp:${normalizedTo}` },
        ],
      },
    });

    if (!waConfig) {
      console.warn(`[whatsapp-webhook] No org found for number: ${to}`);
      return res.status(200).send('<Response></Response>');
    }

    /* Verify this really came from Twilio.
       This endpoint is mounted before `authenticate` (Twilio cannot present a
       JWT), and until now it verified nothing at all — anyone who knew an
       org's WhatsApp number could POST here and inject arbitrary inbound
       conversations and messages into that org's inbox. Stripe's webhook was
       the only signature check in the codebase.

       The org has to be resolved first, because the signature is computed
       with THAT org's Twilio auth token. Validation runs against the org's
       own token when it has one, else the platform token. */
    const signature = req.header('X-Twilio-Signature');
    const authToken = waConfig.authToken || process.env.TWILIO_AUTH_TOKEN || '';

    if (!authToken) {
      // Nothing to verify against. Refuse in production rather than accept
      // unauthenticated writes; in development, warn and continue so the
      // webhook can still be exercised with a tunnel.
      if (process.env.NODE_ENV === 'production') {
        console.error('[whatsapp-webhook] Rejected: no Twilio auth token configured to verify the signature');
        return res.status(403).send('<Response></Response>');
      }
      console.warn('[whatsapp-webhook] No auth token configured — skipping signature check (development only)');
    } else if (!signature || !isValidTwilioSignature(signature, req, authToken)) {
      console.warn(`[whatsapp-webhook] Rejected message with an invalid signature for org ${waConfig.orgId}`);
      return res.status(403).send('<Response></Response>');
    }

    const orgId = waConfig.orgId;
    const contactPhone = from;
    const contactDisplay = from.replace('whatsapp:', '');

    // Find or create conversation for this contact
    let conversation = await prisma.conversation.findFirst({
      where: { orgId, channel: 'WHATSAPP', contactPhone: from },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          orgId,
          channel: 'WHATSAPP',
          contactName: contactDisplay,
          contactPhone: from,
          subject: 'WhatsApp conversation',
          lastMessageAt: new Date(),
        },
      });
    }

    // Avoid duplicate messages
    if (messageSid) {
      const exists = await prisma.message.findFirst({ where: { externalId: messageSid } });
      if (exists) return res.status(200).send('<Response></Response>');
    }

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        fromAddress: contactPhone,
        toAddress: to,
        body,
        externalId: messageSid || undefined,
        sentAt: new Date(),
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), unreadCount: { increment: 1 }, updatedAt: new Date() },
    });

    // Push live update to all org members
    sseManager.broadcastAll(conversation.orgId, SSEEvent.INBOX_MESSAGE, { conversationId: conversation.id, direction: 'INBOUND', from: contactPhone });

    // TwiML empty response — we handle replies manually
    res.status(200).send('<Response></Response>');
  } catch (err) { next(err); }
}
