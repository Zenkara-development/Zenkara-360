import { Router } from 'express';
import { authenticate, requireRole,
         ALL_STAFF, IT_MANAGERS } from '../../middleware/authenticate';
import * as inbox from './inbox.controller';

export const inboxRouter = Router();

// Twilio webhook — public endpoint (no auth; must be before authenticate)
inboxRouter.post('/whatsapp/webhook', inbox.twilioWebhook);

inboxRouter.use(authenticate);

// All staff can read/reply to inbox conversations
inboxRouter.get('/conversations',           requireRole(...ALL_STAFF),   inbox.listConversations);
inboxRouter.get('/conversations/:id',       requireRole(...ALL_STAFF),   inbox.getConversation);
inboxRouter.patch('/conversations/:id',     requireRole(...ALL_STAFF),   inbox.updateConversation);
inboxRouter.post('/conversations/:id/reply',requireRole(...ALL_STAFF),   inbox.sendReply);

// Only IT managers can configure email/WhatsApp accounts
inboxRouter.get('/settings',               requireRole(...IT_MANAGERS), inbox.getSettings);
inboxRouter.post('/settings/email',        requireRole(...IT_MANAGERS), inbox.connectEmail);
inboxRouter.delete('/settings/email',      requireRole(...IT_MANAGERS), inbox.disconnectEmail);
inboxRouter.post('/settings/whatsapp',     requireRole(...IT_MANAGERS), inbox.connectWhatsApp);
inboxRouter.delete('/settings/whatsapp',   requireRole(...IT_MANAGERS), inbox.disconnectWhatsApp);
inboxRouter.post('/sync',                  requireRole(...IT_MANAGERS), inbox.triggerSync);
