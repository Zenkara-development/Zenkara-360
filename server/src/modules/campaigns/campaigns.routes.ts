import { Router } from 'express';
import { authenticate, requireRole,
         CRM_STAFF, CRM_MANAGERS } from '../../middleware/authenticate';
import * as c from './campaigns.controller';

const router = Router();
router.use(authenticate);

// CRM staff can view campaigns; only managers can create/send/delete
router.get('/',            requireRole(...CRM_STAFF),    c.list);
router.post('/',           requireRole(...CRM_MANAGERS), c.create);
router.patch('/:id',       requireRole(...CRM_MANAGERS), c.update);
router.delete('/:id',      requireRole(...CRM_MANAGERS), c.remove);
router.post('/:id/send',   requireRole(...CRM_MANAGERS), c.send);

export { router as campaignsRouter };
