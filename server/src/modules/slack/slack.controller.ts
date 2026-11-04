import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { postToSlack } from '../../utils/slack';

const ConfigSchema = z.object({
  webhookUrl:           z.string().url(),
  channel:              z.string().default('#general'),
  notifyOnNewTicket:    z.boolean().default(true),
  notifyOnCritical:     z.boolean().default(true),
  notifyOnSlaBreached:  z.boolean().default(true),
  notifyOnDealWon:      z.boolean().default(false),
  notifyOnNewLead:      z.boolean().default(false),
});

export async function getConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const config = await prisma.slackConfig.findUnique({
      where: { orgId },
      select: {
        id: true, webhookUrl: true, channel: true,
        notifyOnNewTicket: true, notifyOnCritical: true,
        notifyOnSlaBreached: true, notifyOnDealWon: true, notifyOnNewLead: true,
      },
    });
    res.json(config ?? null);
  } catch (err) { next(err); }
}

export async function saveConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = ConfigSchema.parse(req.body);
    const config = await prisma.slackConfig.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });
    res.json(config);
  } catch (err) { next(err); }
}

export async function deleteConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await prisma.slackConfig.deleteMany({ where: { orgId } });
    res.json({ message: 'Slack integration disconnected' });
  } catch (err) { next(err); }
}

export async function testWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const config = await prisma.slackConfig.findUnique({ where: { orgId } });
    if (!config) return res.status(400).json({ error: 'No Slack config found' });

    await postToSlack(config.webhookUrl, {
      text: '✅ CRM & IT Desk Slack integration is working!',
      attachments: [{
        color: '#48bb78',
        text: 'This is a test message from your CRM & IT Desk platform.',
        footer: 'CRM & IT Desk',
        ts: Math.floor(Date.now() / 1000).toString(),
      }],
    });

    res.json({ message: 'Test message sent successfully' });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Failed to send test message' });
  }
}
