import { Router } from 'express';
import { authenticate, requireRole, CRM_STAFF } from '../../middleware/authenticate';
import * as c from './quotes.controller';

const router = Router();

// Public, token-secured customer-facing quote view + e-signature capture —
// registered before the authenticate middleware below so they stay open.
router.get('/public/:id',        c.publicView);
router.post('/public/:id/accept', c.publicAccept);

router.use(authenticate);

// CRM staff manage quotes (proposals to customers)
router.get('/',              requireRole(...CRM_STAFF), c.list);
router.post('/',             requireRole(...CRM_STAFF), c.create);
router.get('/:id',           requireRole(...CRM_STAFF), c.getOne);
router.get('/:id/share-link', requireRole(...CRM_STAFF), c.getShareLink);
router.patch('/:id',         requireRole(...CRM_STAFF), c.update);
router.patch('/:id/status',  requireRole(...CRM_STAFF), c.changeStatus);
router.delete('/:id',        requireRole(...CRM_STAFF), c.remove);

export { router as quotesRouter };
