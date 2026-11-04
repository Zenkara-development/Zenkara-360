import { Router } from 'express';
import { authenticate, requireRole, IT_MANAGERS } from '../../middleware/authenticate';
import * as c from './slack.controller';

const router = Router();
router.use(authenticate);

// Slack integration is an IT-owned integration
router.get('/config',    requireRole(...IT_MANAGERS), c.getConfig);
router.put('/config',    requireRole(...IT_MANAGERS), c.saveConfig);
router.delete('/config', requireRole(...IT_MANAGERS), c.deleteConfig);
router.post('/test',     requireRole(...IT_MANAGERS), c.testWebhook);

export { router as slackRouter };
