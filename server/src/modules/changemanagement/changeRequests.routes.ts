import { Router } from 'express';
import { authenticate, requireRole,
         IT_STAFF, IT_MANAGERS } from '../../middleware/authenticate';
import * as c from './changeRequests.controller';

const router = Router();
router.use(authenticate);

// IT staff can view and create change requests
router.get('/',              requireRole(...IT_STAFF),    c.list);
router.post('/',             requireRole(...IT_STAFF),    c.create);
router.get('/:id',           requireRole(...IT_STAFF),    c.getOne);
router.patch('/:id',         requireRole(...IT_STAFF),    c.update);
router.patch('/:id/status',  requireRole(...IT_STAFF),    c.changeStatus);

// Only IT managers can approve/reject/delete change requests
router.post('/:id/approve',  requireRole(...IT_MANAGERS), c.approve);
router.post('/:id/reject',   requireRole(...IT_MANAGERS), c.reject);
router.delete('/:id',        requireRole(...IT_MANAGERS), c.remove);

export { router as changeRequestsRouter };
