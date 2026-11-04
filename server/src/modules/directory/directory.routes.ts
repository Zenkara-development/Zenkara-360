import { Router } from 'express';
import { authenticate, requireRole, IT_MANAGERS } from '../../middleware/authenticate';
import * as c from './directory.controller';

const router = Router();

// Unattended cron target (GitHub Actions → this endpoint, no user session) —
// must be registered BEFORE router.use(authenticate) below, since it's gated
// by its own shared secret instead of a JWT. Mirrors demo.routes.ts's
// POST /demo/reset.
router.post('/sync-all', c.syncAll);

router.use(authenticate);

// Single sign-on is an IT-owned integration, same gating as Slack/Teams.
router.get('/config',    requireRole(...IT_MANAGERS), c.getConfig);
router.put('/config',    requireRole(...IT_MANAGERS), c.saveConfig);
router.delete('/config', requireRole(...IT_MANAGERS), c.deleteConfig);
router.post('/test',     requireRole(...IT_MANAGERS), c.testConnection);

router.get('/mappings',       requireRole(...IT_MANAGERS), c.listMappings);
router.post('/mappings',      requireRole(...IT_MANAGERS), c.createMapping);
router.patch('/mappings/:id', requireRole(...IT_MANAGERS), c.updateMapping);
router.delete('/mappings/:id', requireRole(...IT_MANAGERS), c.deleteMapping);

router.post('/sync',       requireRole(...IT_MANAGERS), c.syncNow);
router.get('/sync-logs',   requireRole(...IT_MANAGERS), c.listSyncLogs);

export { router as directoryRouter };
