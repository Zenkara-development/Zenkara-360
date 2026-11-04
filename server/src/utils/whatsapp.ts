import https from 'https';
import { prisma } from './prisma';
import { recordUsage } from './usageTracking';
import { getPlatformWhatsAppConfig } from './platformSettings';

/**
 * Low-level Twilio REST call (no SDK — direct HTTPS request). Mirrors the
 * private sendTwilioMessage() in inbox.controller.ts (kept separate rather
 * than refactored to share code, to avoid touching the already-working
 * Inbox WhatsApp reply flow) — used here by the Schedule poller and the
 * workflow engine's SEND_WHATSAPP action, neither of which has an existing
 * Conversation to reply on.
 */
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
              reject(new Error(json.message || `Twilio error (${res.statusCode})`));
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

// Platform fallback (White-Label Sending & Licensing Plan): an org that
// hasn't connected its own WhatsApp Business number can still have
// workflow/schedule WhatsApp notifications go out, sent from the platform's
// own Twilio number instead. Resolved live via getPlatformWhatsAppConfig()
// (Platform Admin console override, falling back to TWILIO_ACCOUNT_SID/
// TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER) rather than read once at import
// time, so a console edit takes effect immediately without a redeploy.
//
// Note this only covers *outbound, org-initiated* sends (Schedule poller,
// workflow SEND_WHATSAPP action) — the Inbox's two-way conversation replies
// still require the org's own number, since inbound routing depends on
// which number the customer messaged in the first place (see
// inbox.controller.ts's webhook, which matches by phoneNumber).

/**
 * Sends a WhatsApp message on behalf of an org. Prefers the org's own
 * connected WhatsApp account (Inbox → Settings, the same Twilio config
 * two-way conversations use); falls back to the platform's own Twilio
 * number if the org hasn't connected one and TWILIO_ACCOUNT_SID/
 * TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER are configured. Reused by the
 * Schedule poller and the workflow engine's SEND_WHATSAPP action — neither
 * of those has a "conversation" to hang off of, so this takes a raw phone
 * number instead.
 *
 * `toNumber` should be a plain E.164 number (e.g. +14155551234) — the
 * `whatsapp:` prefix Twilio requires is added here.
 */
export async function sendWhatsApp(orgId: string, toNumber: string, body: string): Promise<{ sid: string }> {
  if (!toNumber) throw new Error('No recipient phone number available.');
  const to = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;

  const waConfig = await prisma.whatsAppConfig.findUnique({ where: { orgId } });
  if (waConfig) {
    const from = waConfig.phoneNumber.startsWith('whatsapp:') ? waConfig.phoneNumber : `whatsapp:${waConfig.phoneNumber}`;
    const result = await sendTwilioMessage(waConfig.accountSid, waConfig.authToken, from, to, body);
    recordUsage(orgId, 'WHATSAPP_SEND', 'OWN');
    return result;
  }

  const platformCfg = await getPlatformWhatsAppConfig();
  if (!platformCfg.accountSid || !platformCfg.authToken || !platformCfg.fromNumber) {
    throw new Error('No WhatsApp account connected for this organization, and no platform fallback is configured. Go to Inbox → Settings to connect one.');
  }

  // Best-effort branding: WhatsApp has no "From Name" the way email does —
  // the sender the recipient sees is just the platform's shared number — so
  // the closest we can get to "looks like it's from the org" is a bold
  // company-name line at the top of the message body itself.
  const branding = await prisma.orgBranding.findUnique({ where: { orgId }, select: { companyName: true } }).catch(() => null);
  const brandedBody = branding?.companyName ? `*${branding.companyName}*\n\n${body}` : body;

  const from = platformCfg.fromNumber.startsWith('whatsapp:') ? platformCfg.fromNumber : `whatsapp:${platformCfg.fromNumber}`;
  const result = await sendTwilioMessage(platformCfg.accountSid, platformCfg.authToken, from, to, brandedBody);
  recordUsage(orgId, 'WHATSAPP_SEND', 'PLATFORM');
  return result;
}
