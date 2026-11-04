import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { sendMail } from '../../utils/mailer';
import { purgeEntityChildren } from '../../utils/entityCleanup';

const Schema = z.object({
  name:       z.string().min(1),
  subject:    z.string().min(1),
  body:       z.string().min(1),
  targetType: z.enum(['LEADS', 'CONTACTS']).default('LEADS'),
});

/**
 * Sends to `items` a handful at a time instead of all at once. A campaign
 * with hundreds/thousands of recipients previously fired every email
 * concurrently via Promise.all — no batching, no throttling, and no
 * isolation from one slow/failing send blocking the event loop with a huge
 * number of simultaneous in-flight requests to the SMTP provider (which can
 * get the sending account rate-limited or flagged as abuse).
 */
async function sendInBatches<T>(
  items: T[],
  sendOne: (item: T) => Promise<unknown>,
  batchSize = 10,
  delayMs = 250,
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(item => sendOne(item).then(() => { sent++; }).catch(() => {})));
    if (i + batchSize < items.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return sent;
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const campaigns = await prisma.campaign.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: campaigns });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = Schema.parse(req.body);
    const campaign = await prisma.campaign.create({ data: { ...data, orgId } });
    res.status(201).json(campaign);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    await prisma.campaign.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId }, data });
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    res.json(campaign);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count } = await prisma.campaign.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    // Comments, attachments and tasks hang off this record by a loose
    // entityType/entityId pair, so the database cannot cascade them.
    if (count) await purgeEntityChildren('CAMPAIGN', req.params.id, req.user!.orgId);
    res.json({ message: 'Campaign deleted' });
  } catch (err) { next(err); }
}

/**
 * Core send logic, pulled out of the send() route handler below so the AI
 * action registry (SEND_CAMPAIGN in ai-actions.ts) can trigger the exact
 * same recipient-gathering + throttled-batch-send behavior instead of a
 * second, drifting copy of it — the existence check and "already sent" guard
 * stay in each caller since those are about *whether* to send, not *how*.
 */
export async function sendCampaignNow(
  campaign: { id: string; name: string; targetType: string; subject: string; body: string },
  orgId: string
): Promise<{ recipients: number }> {
  // Gather recipients
  let emails: string[] = [];
  if (campaign.targetType === 'LEADS') {
    const leads = await prisma.lead.findMany({
      where: { orgId, status: { not: 'CONVERTED' } },
      include: { contact: { select: { email: true } } },
    });
    emails = leads.map(l => l.contact?.email).filter(Boolean) as string[];
  } else {
    const contacts = await prisma.contact.findMany({ where: { orgId }, select: { email: true } });
    emails = contacts.map(c => c.email).filter(Boolean) as string[];
  }

  // Mark as SENDING
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } });

  // Send emails in the background, throttled in small batches (see
  // sendInBatches above) rather than all at once.
  sendInBatches(emails, to =>
    sendMail({
      orgId,
      to,
      subject: campaign.subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">${campaign.body.replace(/\n/g, '<br/>')}</div>`,
    })
  ).then(async sent => {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'SENT', sentAt: new Date(), sentCount: sent },
    });
    console.log(`[campaign] "${campaign.name}" sent to ${sent}/${emails.length} recipients`);
  });

  return { recipients: emails.length };
}

export async function send(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, orgId } });
    if (!campaign) throw new AppError(404, 'Campaign not found');
    if (campaign.status === 'SENT') throw new AppError(400, 'Campaign already sent');

    const { recipients } = await sendCampaignNow(campaign, orgId);
    res.json({ message: `Sending to ${recipients} recipients…`, recipients });
  } catch (err) { next(err); }
}
