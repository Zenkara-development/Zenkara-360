import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { postToTeams } from '../../utils/teams';

const Schema = z.object({
  webhookUrl:           z.string().url(),
  notifyOnNewTicket:    z.boolean().default(true),
  notifyOnCritical:     z.boolean().default(true),
  notifyOnSlaBreached:  z.boolean().default(true),
  notifyOnDealWon:      z.boolean().default(false),
  notifyOnNewLead:      z.boolean().default(false),
});

export async function getConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const config = await prisma.teamsConfig.findUnique({ where: { orgId: req.user!.orgId } });
    res.json(config ?? null);
  } catch (err) { next(err); }
}

export async function saveConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = Schema.parse(req.body);
    const config = await prisma.teamsConfig.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });
    res.json(config);
  } catch (err) { next(err); }
}

export async function deleteConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.teamsConfig.deleteMany({ where: { orgId: req.user!.orgId } });
    res.json({ message: 'Teams integration disconnected' });
  } catch (err) { next(err); }
}

export async function testWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const config = await prisma.teamsConfig.findUnique({ where: { orgId: req.user!.orgId } });
    if (!config) return res.status(400).json({ error: 'No Teams config found' });

    await postToTeams(config.webhookUrl, {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [{ type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: '✅ CRM & IT Desk Teams integration is working!' }],
        },
      }],
    });

    res.json({ message: 'Test message sent to Teams' });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Failed to send test message' });
  }
}
