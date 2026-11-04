import nodemailer from 'nodemailer';
import { prisma } from './prisma';
import { decryptSecretOrPlain } from './crypto';
import { recordUsage } from './usageTracking';
import { getPlatformMailConfig, type PlatformMailConfig } from './platformSettings';
import { enqueueJob, registerJobHandler } from './jobQueue';

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  // When set, sendMail() tries the org's own connected EmailAccount first
  // (Inbox → Settings) so customer-facing mail — portal login links, ticket
  // notifications, invites, campaigns — comes from the org's own address and
  // display name instead of a shared platform sender. Falls back to the
  // platform Resend/SMTP mailer below if the org has no EmailAccount
  // connected, or if sending through it fails for any reason.
  orgId?: string;
  /** Base64 so the payload survives the job-queue JSON round trip on retry. */
  attachments?: { filename: string; contentBase64: string; contentType?: string }[];
}

const nodemailerAttachments = (opts: MailOptions) => opts.attachments?.map(a => ({ filename: a.filename, content: Buffer.from(a.contentBase64, 'base64'), contentType: a.contentType }));

// Render's free web-service tier blocks all outbound SMTP traffic (ports 25,
// 465, 587) — confirmed by the ETIMEDOUT/CONN errors nodemailer throws there
// regardless of which SMTP host you point it at. Resend's HTTP API runs over
// plain HTTPS (443), so it isn't affected. When a Resend key is configured
// (Platform Admin console, falling back to RESEND_API_KEY), it's used
// instead of SMTP entirely; SMTP remains as the fallback for local dev or a
// paid Render plan where outbound SMTP isn't blocked. Both are resolved
// live per-send via getPlatformMailConfig() rather than read once at import
// time, so a Platform Admin console edit takes effect immediately.
// Only used for Resend with no RESEND_FROM/SMTP_FROM set — Resend's shared
// test sender. The SMTP path falls back to the authenticated SMTP_USER instead
// (Gmail rewrites any other From to that address anyway).
const DEFAULT_FROM_ADDRESS = 'Zenkara 360 <onboarding@resend.dev>';

async function sendViaResend(opts: MailOptions, apiKey: string, from: string, replyTo?: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from, to: opts.to, subject: opts.subject, html: opts.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(opts.attachments?.length ? { attachments: opts.attachments.map(a => ({ filename: a.filename, content: a.contentBase64 })) } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
}

// Lazy transporter — only created when SMTP is configured
function buildPlatformTransporter(cfg: PlatformMailConfig) {
  if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) return null;
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort || 587,
    secure: cfg.smtpPort === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    // Nodemailer's defaults (2min connection, 10min socket) mean a blocked or
    // slow-to-respond SMTP host hangs the *caller* for that long on every
    // `await sendMail(...)` — e.g. register()/approve-org-signup silently not
    // finishing when the network path to smtpout.secureserver.net is slow.
    // Fail fast instead; email delivery isn't worth blocking a request over.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

/**
 * Builds a transporter + branded "From" header from the org's own connected
 * EmailAccount (Inbox → Settings), or null if the org hasn't connected one.
 * Shared by sendMail() below and by workflow-engine.ts's SEND_EMAIL action,
 * which used to duplicate this exact lookup inline.
 */
async function getOrgMailer(orgId: string): Promise<{ transport: nodemailer.Transporter; from: string } | null> {
  const [emailAccount, org, branding] = await Promise.all([
    prisma.emailAccount.findUnique({ where: { orgId } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.orgBranding.findUnique({ where: { orgId }, select: { companyName: true } }),
  ]);
  if (!emailAccount) return null;

  const transport = nodemailer.createTransport({
    host: emailAccount.smtpHost,
    port: emailAccount.smtpPort,
    secure: emailAccount.smtpPort === 465,
    // decryptSecretOrPlain, not the raw column — EmailAccount.password is
    // stored encrypted (see inbox.controller.ts's encryptSecret on save).
    // The previous inline copy of this lookup (workflow-engine.ts's
    // SEND_EMAIL case) used the raw encrypted value directly, which meant
    // SMTP auth was silently failing with the ciphertext as the password
    // any time an org had actually connected their own email account.
    auth: { user: emailAccount.email, pass: decryptSecretOrPlain(emailAccount.password) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  const fromName = (branding?.companyName || org?.name || '').replace(/"/g, '');
  const from = fromName ? `"${fromName}" <${emailAccount.email}>` : emailAccount.email;
  return { transport, from };
}

interface MailBranding {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  replyTo: string | null;
}

/**
 * White-label Tier 1 (see the White-Label Sending & Licensing Plan doc):
 * when mail goes out through the *platform's* shared Resend/SMTP account
 * rather than the org's own connected mailbox, it still shouldn't look like
 * it came from "CRM & IT Desk" — it should look like it came from the org.
 * Reads OrgBranding (already used on the customer portal) and reuses it here.
 */
async function getMailBranding(orgId: string): Promise<MailBranding | null> {
  const [branding, org] = await Promise.all([
    prisma.orgBranding.findUnique({ where: { orgId }, select: { companyName: true, logoUrl: true, primaryColor: true, supportEmail: true } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
  ]);
  const companyName = (branding?.companyName || org?.name || '').trim();
  if (!companyName && !branding?.logoUrl) return null; // nothing to brand with
  return {
    companyName,
    logoUrl: branding?.logoUrl || null,
    primaryColor: branding?.primaryColor || '#4f46e5',
    replyTo: branding?.supportEmail || null,
  };
}

/** Keeps the platform's verified sending address, swaps only the display name. */
function brandedFromAddress(companyName: string, fromAddress: string): string {
  const match = fromAddress.match(/<([^>]+)>/);
  const emailPart = match ? match[1] : fromAddress;
  const safeName = companyName.replace(/"/g, '');
  return safeName ? `"${safeName}" <${emailPart}>` : fromAddress;
}

/** Prepends a small logo/company-name header banner in the org's own color, above the existing template content. */
function withBrandHeader(html: string, branding: MailBranding): string {
  const mark = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="height:32px;max-width:200px;object-fit:contain" />`
    : `<span style="font-weight:700;font-size:18px;color:${branding.primaryColor}">${branding.companyName}</span>`;
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto 4px;padding-bottom:12px;border-bottom:3px solid ${branding.primaryColor}">${mark}</div>${html}`;
}

/**
 * Does the actual delivery work, with no swallowing on final failure — a
 * Resend/SMTP error here is thrown to the caller. Split out from sendMail()
 * below so both the "try it right now" path and the job-queue retry path
 * (registerJobHandler('send_email', ...) at the bottom of this file) share
 * one implementation instead of duplicating the branding/fallback logic.
 */
async function performSendMail(opts: MailOptions): Promise<void> {
  if (opts.orgId) {
    try {
      const orgMailer = await getOrgMailer(opts.orgId);
      if (orgMailer) {
        await orgMailer.transport.sendMail({ from: orgMailer.from, to: opts.to, subject: opts.subject, html: opts.html, attachments: nodemailerAttachments(opts) });
        console.log(`[Email sent via org SMTP] To: ${opts.to} | ${opts.subject}`);
        recordUsage(opts.orgId, 'EMAIL_SEND', 'OWN');
        return;
      }
    } catch (err) {
      console.error('[Email error — org SMTP, falling back to platform mailer]', err);
      // fall through to the platform mailer below rather than giving up —
      // a misconfigured org SMTP account shouldn't mean the customer never
      // gets a critical link (portal login, ticket resolution, ...).
    }
  }

  // Tier 1 white-label: still sending through the platform's own domain/
  // account below, but dressed as the org wherever we have branding for it.
  const [branding, cfg] = await Promise.all([
    opts.orgId ? getMailBranding(opts.orgId).catch(() => null) : Promise.resolve(null),
    getPlatformMailConfig(),
  ]);
  const platformFromAddress = cfg.resendFrom || cfg.smtpFrom
    || (!cfg.resendApiKey && cfg.smtpUser ? `Zenkara 360 <${cfg.smtpUser}>` : DEFAULT_FROM_ADDRESS);
  const from = branding ? brandedFromAddress(branding.companyName, platformFromAddress) : platformFromAddress;
  const html = branding ? withBrandHeader(opts.html, branding) : opts.html;
  const replyTo = branding?.replyTo || undefined;

  if (cfg.resendApiKey) {
    // No try/catch here — a Resend failure propagates to the caller
    // (sendMail() below, or the job-queue retry handler), which is what
    // decides whether to queue a retry or record the final failure.
    await sendViaResend({ ...opts, html }, cfg.resendApiKey, from, replyTo);
    console.log(`[Email sent via Resend]${branding ? ` (branded as "${branding.companyName}")` : ''} To: ${opts.to} | ${opts.subject}`);
    if (opts.orgId) recordUsage(opts.orgId, 'EMAIL_SEND', 'PLATFORM');
    return;
  }

  const transporter = buildPlatformTransporter(cfg);
  if (!transporter) {
    // Not a failure — nothing is configured, so there's nothing a retry
    // would accomplish either. Same as before: log and no-op.
    console.log(`[Email skipped — no Resend key or SMTP configured] To: ${opts.to} | ${opts.subject}`);
    return;
  }
  await transporter.sendMail({ from, replyTo, to: opts.to, subject: opts.subject, html, attachments: nodemailerAttachments(opts) });
  console.log(`[Email sent via SMTP]${branding ? ` (branded as "${branding.companyName}")` : ''} To: ${opts.to} | ${opts.subject}`);
  if (opts.orgId) recordUsage(opts.orgId, 'EMAIL_SEND', 'PLATFORM');
}

/**
 * Public entry point every caller in the app already uses. Tries delivery
 * immediately (same as before); on failure, instead of just logging and
 * dropping the message, queues a retry with exponential backoff — see
 * jobQueue.ts. Still never throws, so every existing `await sendMail(...)`
 * call site keeps working exactly as it did.
 */
export async function sendMail(opts: MailOptions): Promise<void> {
  try {
    await performSendMail(opts);
  } catch (err) {
    console.error('[Email error — queuing retry]', err);
    await enqueueJob('send_email', opts, { orgId: opts.orgId ?? null });
  }
}

registerJobHandler('send_email', async (payload: MailOptions) => {
  await performSendMail(payload);
});

// ─── Reusable HTML templates ─────────────────────────────────────────────────

const base = (content: string, color = '#4f46e5') => `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111">
    ${content}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
    <p style="font-size:12px;color:#9ca3af">CRM & IT Desk — you're receiving this because you're a member of your organization.</p>
  </div>
`;

const highlight = (text: string, color = '#4f46e5') => `
  <div style="background:#f5f3ff;border-left:4px solid ${color};padding:12px 16px;margin:16px 0;border-radius:4px">
    ${text}
  </div>
`;

const btn = (href: string, label: string, color = '#4f46e5') =>
  `<a href="${href}" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">${label}</a>`;

export const emailTemplates = {
  invite: (to: string, orgName: string, role: string, link: string) => ({
    to,
    subject: `You've been invited to join ${orgName}`,
    html: base(`
      <h2 style="color:#4f46e5">You're invited!</h2>
      <p>You've been invited to join <strong>${orgName}</strong> as a <strong>${role.replace(/_/g, ' ')}</strong>.</p>
      <p>Click below to set up your account. This link expires in 7 days.</p>
      ${btn(link, 'Accept Invitation')}
      <p style="color:#6b7280;font-size:13px">Or copy this link: <code>${link}</code></p>
    `),
  }),

  ticketCreated: (ticket: { title: string }, requesterName: string, assigneeEmail: string) => ({
    to: assigneeEmail,
    subject: `[Ticket] New: ${ticket.title}`,
    html: base(`
      <h2 style="color:#2563eb">New Ticket Submitted</h2>
      <p><strong>${requesterName}</strong> submitted a new support ticket:</p>
      ${highlight(`<strong>${ticket.title}</strong>`, '#2563eb')}
      <p>Log in to view and respond to this ticket.</p>
    `, '#2563eb'),
  }),

  ticketAssigned: (ticket: { title: string }, assigneeName: string, assigneeEmail: string) => ({
    to: assigneeEmail,
    subject: `[Ticket] Assigned to you: ${ticket.title}`,
    html: base(`
      <h2 style="color:#2563eb">Ticket Assigned to You</h2>
      <p>Hi <strong>${assigneeName}</strong>, a ticket has been assigned to you:</p>
      ${highlight(`<strong>${ticket.title}</strong>`, '#2563eb')}
      <p>Log in to view and start working on it.</p>
    `, '#2563eb'),
  }),

  ticketResolved: (ticket: { title: string }, requesterName: string, requesterEmail: string) => ({
    to: requesterEmail,
    subject: `[Ticket] Resolved: ${ticket.title}`,
    html: base(`
      <h2 style="color:#16a34a">Your Ticket Has Been Resolved</h2>
      <p>Hi <strong>${requesterName}</strong>, your ticket has been resolved:</p>
      ${highlight(`<strong>${ticket.title}</strong>`, '#16a34a')}
      <p>If you need further help, please submit a new ticket.</p>
    `, '#16a34a'),
  }),

  ticketStatusChanged: (ticket: { title: string }, status: string, requesterName: string, requesterEmail: string) => ({
    to: requesterEmail,
    subject: `[Ticket] Status update: ${ticket.title}`,
    html: base(`
      <h2 style="color:#d97706">Ticket Status Updated</h2>
      <p>Hi <strong>${requesterName}</strong>, your ticket status has changed to <strong>${status.replace(/_/g, ' ')}</strong>:</p>
      ${highlight(`<strong>${ticket.title}</strong>`, '#d97706')}
    `, '#d97706'),
  }),

  csatSurvey: (ticket: { id: string; title: string }, requesterName: string, requesterEmail: string) => {
    const base_url = process.env.APP_URL || 'http://localhost:5173';
    const link = `${base_url}/api/csat/submit/${ticket.id}`;
    return {
      to: requesterEmail,
      subject: `How did we do? Rate your support experience`,
      html: base(`
        <h2 style="color:#4f46e5">How was your experience?</h2>
        <p>Hi <strong>${requesterName}</strong>, we recently resolved your ticket:</p>
        ${highlight(`<strong>${ticket.title}</strong>`, '#4f46e5')}
        <p>We'd love your feedback! Click a star below to rate your experience:</p>
        <div style="text-align:center;margin:24px 0;font-size:36px">
          ${[1,2,3,4,5].map(r => `<a href="${link}?rating=${r}&via=email" style="text-decoration:none;margin:0 4px">⭐</a>`).join('')}
        </div>
        <p style="color:#6b7280;font-size:12px">You can also <a href="${link}">submit feedback with a comment</a>.</p>
      `),
    };
  },

  orgSignupRequest: (adminEmail: string, req: { organizationName: string; name: string; email: string }, approveLink: string) => ({
    to: adminEmail,
    subject: `New org signup request: ${req.organizationName}`,
    html: base(`
      <h2 style="color:#4f46e5">New Organization Signup Request</h2>
      <p>Someone just requested a new workspace:</p>
      ${highlight(`
        <strong>${req.organizationName}</strong><br/>
        ${req.name} &lt;${req.email}&gt;
      `)}
      <p>Nothing has been created yet — review and approve (or reject) below.</p>
      ${btn(approveLink, 'Review request')}
      <p style="color:#6b7280;font-size:13px">Or copy this link: <code>${approveLink}</code></p>
    `),
  }),

  orgSignupApproved: (requesterEmail: string, requesterName: string, orgName: string, loginLink: string) => ({
    to: requesterEmail,
    subject: `You're approved — ${orgName} is ready`,
    html: base(`
      <h2 style="color:#16a34a">You're approved!</h2>
      <p>Hi <strong>${requesterName}</strong>, your workspace <strong>${orgName}</strong> has been approved.</p>
      <p>You can log in now with the email and password you signed up with.</p>
      ${btn(loginLink, 'Log in', '#16a34a')}
    `, '#16a34a'),
  }),

  passwordReset: (to: string, name: string, resetLink: string) => ({
    to,
    subject: 'Reset your password',
    html: base(`
      <h2 style="color:#4f46e5">Reset your password</h2>
      <p>Hi <strong>${name}</strong>, we received a request to reset your password. This link expires in 30 minutes.</p>
      ${btn(resetLink, 'Reset password')}
      <p style="color:#6b7280;font-size:13px">Or copy this link: <code>${resetLink}</code></p>
      <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    `),
  }),

  passwordChanged: (to: string, name: string) => ({
    to,
    subject: 'Your password was changed',
    html: base(`
      <h2 style="color:#4f46e5">Password changed</h2>
      <p>Hi <strong>${name}</strong>, your password was just changed. If this wasn't you, contact your workspace admin immediately.</p>
    `),
  }),

  leaveRequested: (to: string, managerName: string, requesterName: string, leaveTypeName: string, startDate: string, endDate: string, days: number) => ({
    to,
    subject: `Leave request from ${requesterName}`,
    html: base(`
      <h2 style="color:#4f46e5">New leave request</h2>
      <p>Hi <strong>${managerName}</strong>, <strong>${requesterName}</strong> has requested time off.</p>
      ${highlight(`
        <strong>${leaveTypeName}</strong><br/>
        ${startDate} &rarr; ${endDate} (${days} day${days === 1 ? '' : 's'})
      `)}
      <p>Review it from the Leave page in the app.</p>
    `),
  }),

  leaveDecision: (to: string, requesterName: string, leaveTypeName: string, startDate: string, endDate: string, approved: boolean, reason?: string) => ({
    to,
    subject: `Your leave request was ${approved ? 'approved' : 'rejected'}`,
    html: base(`
      <h2 style="color:${approved ? '#16a34a' : '#dc2626'}">Leave request ${approved ? 'approved' : 'rejected'}</h2>
      <p>Hi <strong>${requesterName}</strong>, your <strong>${leaveTypeName}</strong> request for ${startDate} &rarr; ${endDate} was ${approved ? 'approved' : 'rejected'}.</p>
      ${reason ? `<p style="color:#6b7280;font-size:13px">Reason: ${reason}</p>` : ''}
    `, approved ? '#16a34a' : '#dc2626'),
  }),

  dealStageChanged: (deal: { title: string; stage: string }, assigneeName: string, assigneeEmail: string) => ({
    to: assigneeEmail,
    subject: `[CRM] Deal moved to ${deal.stage}: ${deal.title}`,
    html: base(`
      <h2 style="color:#7c3aed">Deal Stage Updated</h2>
      <p>Hi <strong>${assigneeName}</strong>, a deal you own has moved stages:</p>
      ${highlight(`<strong>${deal.title}</strong><br/><span style="color:#7c3aed">→ ${deal.stage}</span>`, '#7c3aed')}
    `, '#7c3aed'),
  }),
};
