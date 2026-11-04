import { Router } from 'express';
import { authenticate, requireRole, IT_MANAGERS } from '../../middleware/authenticate';
import * as c from './teams.controller';

const router = Router();
router.use(authenticate);

// Teams integration is an IT-owned integration
router.get('/',     requireRole(...IT_MANAGERS), c.getConfig);
router.post('/',    requireRole(...IT_MANAGERS), c.saveConfig);
router.put('/',     requireRole(...IT_MANAGERS), c.saveConfig);
router.delete('/',  requireRole(...IT_MANAGERS), c.deleteConfig);
router.post('/test',requireRole(...IT_MANAGERS), c.testWebhook);

export { router as teamsRouter };
