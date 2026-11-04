import { Router } from 'express';
import { authenticate, requireRole, ADMIN, MANAGERS } from '../../middleware/authenticate';
import * as c from './storage.controller';

export const storageRouter = Router();

// Callback is hit directly by Google's redirect — no Authorization header
// exists at that point, so it must stay outside the authenticate() gate.
// It's protected instead by the signed, short-lived `state` param minted in
// connectGoogleDrive below.
storageRouter.get('/google/callback', c.googleCallback);

storageRouter.use(authenticate);
// Any manager can see whether storage is connected; only the org owner can
// change it — connecting an OAuth integration is a significant trust
// decision, same level as billing.
storageRouter.get('/status',           requireRole(...MANAGERS), c.getStatus);
// The storage calculator — usage totals, per-record-type breakdown, quota
// headroom and a "roughly N more files fit" projection.
storageRouter.get('/usage',            requireRole(...MANAGERS), c.getUsageBreakdown);
storageRouter.get('/google/connect',   requireRole(...ADMIN),    c.connectGoogleDrive);
storageRouter.post('/hosted/connect',  requireRole(...ADMIN),    c.connectHosted);
// Bring-your-own S3-compatible bucket. The preset list is harmless reference
// data, so any manager can load the form; testing and connecting send real
// credentials and are owner-only like every other connect above.
storageRouter.get('/s3/presets',       requireRole(...MANAGERS), c.s3Presets);
storageRouter.post('/s3/test',         requireRole(...ADMIN),    c.testCustomS3);
storageRouter.post('/s3/connect',      requireRole(...ADMIN),    c.connectCustomS3);
storageRouter.delete('/',              requireRole(...ADMIN),    c.disconnect);
