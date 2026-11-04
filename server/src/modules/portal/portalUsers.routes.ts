import { Router } from 'express';
import { authenticate, requireRole, IT_MANAGERS } from '../../middleware/authenticate';
import { requireFeature } from '../../utils/licensing';
import * as c from './portalUsers.controller';

const router = Router();
router.use(authenticate);

// Only IT managers can manage customer portal accounts. The customer portal
// is a Pro+ feature — gated only on provisioning *new* portal accounts;
// existing portal customers from a since-downgraded org keep their access
// (list/toggle/resend/remove all stay open), same grandfathering pattern as
// workflow automation.
router.get('/',                    requireRole(...IT_MANAGERS), c.list);
router.post('/',                   requireRole(...IT_MANAGERS), requireFeature('customer_portal'), c.create);
router.patch('/:id/toggle',        requireRole(...IT_MANAGERS), c.toggleActive);
router.post('/:id/resend-invite',  requireRole(...IT_MANAGERS), c.resendInvite);
router.delete('/:id',              requireRole(...IT_MANAGERS), c.remove);

export { router as portalUsersRouter };
