import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import * as c from './calendar.controller';

const router = Router();

// Public — Google redirects the browser here after the user grants consent;
// there's no Authorization header on a browser redirect, so the requesting
// user is identified via the signed `state` param instead (see getOAuthUrl).
router.get('/callback', c.oauthCallback);

router.use(authenticate);
router.get('/status', c.getStatus);
router.get('/oauth-url', c.getOAuthUrl);
router.patch('/settings', c.updateSettings);
router.delete('/connection', c.disconnect);
router.post('/sync', c.manualSync);

export { router as calendarRouter };
