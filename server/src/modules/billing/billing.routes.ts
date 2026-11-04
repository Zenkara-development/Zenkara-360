import express, { Router } from 'express';
import { authenticate, requireRole, ADMIN, ALL_USERS } from '../../middleware/authenticate';
import * as c from './billing.controller';

const router = Router();

// Webhook must receive raw body for Stripe signature verification (no auth)
router.post('/webhook', express.raw({ type: 'application/json' }), c.handleWebhook);

// Read-only licence info for every signed-in user (nav visibility, payment banners)
router.get('/pricing',       authenticate, requireRole(...ALL_USERS), c.getPricing);
router.get('/entitlements',  authenticate, requireRole(...ALL_USERS), c.getEntitlements);

// Only org admin can manage billing
router.get('/subscription',     authenticate, requireRole(...ADMIN), c.getSubscription);
router.post('/quote',           authenticate, requireRole(...ADMIN), c.quoteCustom);
router.post('/checkout',        authenticate, requireRole(...ADMIN), c.createCheckout);
router.post('/custom-checkout', authenticate, requireRole(...ADMIN), c.createCustomCheckout);
router.post('/portal',          authenticate, requireRole(...ADMIN), c.createPortal);

export { router as billingRouter };
