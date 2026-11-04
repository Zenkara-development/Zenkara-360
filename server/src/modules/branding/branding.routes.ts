import { Router } from 'express';
import { authenticate, requireRole,
         ALL_USERS, ADMIN } from '../../middleware/authenticate';
import { requireFeature } from '../../utils/licensing';
import * as c from './branding.controller';

const router = Router();

// Public — portal uses this (no auth required). Never gated: an org that
// already set custom branding while on Enterprise keeps displaying it to
// its customers even if it later downgrades.
router.get('/public/:orgId', c.getPublicBranding);

router.use(authenticate);
// Any authenticated user can read branding (used for org logo display) —
// also ungated for the same grandfathering reason as above.
router.get('/',  requireRole(...ALL_USERS), c.getBranding);
// Custom branding is Enterprise-only. Only *setting* it is gated.
router.post('/', requireRole(...ADMIN),     requireFeature('custom_branding'), c.saveBranding);
router.put('/',  requireRole(...ADMIN),     requireFeature('custom_branding'), c.saveBranding);

export { router as brandingRouter };
