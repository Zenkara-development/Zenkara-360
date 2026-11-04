import { Router } from 'express';
import { authenticate, requireRole, MANAGERS } from '../../middleware/authenticate';
import * as c from './jobs.controller';

const router = Router();
router.use(authenticate);

// Manager-level+ only — this is system/delivery-reliability visibility, not
// something every staff member needs, but doesn't need to be locked to the
// single org-owner role the way API key management is.
router.get('/',            requireRole(...MANAGERS), c.listJobs);
router.post('/:id/retry',  requireRole(...MANAGERS), c.retryJobNow);

export { router as jobsRouter };
