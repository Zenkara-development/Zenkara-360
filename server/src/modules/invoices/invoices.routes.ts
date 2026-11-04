import { Router } from 'express';
import { authenticate, requireRole, CRM_STAFF, CRM_MANAGERS } from '../../middleware/authenticate';
import * as c from './invoices.controller';

const router = Router();

// Public, token-secured customer-facing invoice view — before authenticate.
router.get('/public/:id', c.publicView);

router.use(authenticate);

router.get('/',                requireRole(...CRM_STAFF), c.list);
router.post('/',               requireRole(...CRM_STAFF), c.create);
router.get('/:id',             requireRole(...CRM_STAFF), c.getOne);
router.get('/:id/share-link',  requireRole(...CRM_STAFF), c.getShareLink);
router.patch('/:id',           requireRole(...CRM_STAFF), c.update);
router.patch('/:id/status',    requireRole(...CRM_STAFF), c.changeStatus);
router.delete('/:id',          requireRole(...CRM_MANAGERS), c.remove);

export { router as invoicesRouter };
