import { Router } from 'express';
import { authenticate, requireRole,
         IT_STAFF, IT_MANAGERS } from '../../../middleware/authenticate';
import * as c from './assets.controller';

const router = Router();
router.use(authenticate);

// IT staff can view assets
router.get('/',        requireRole(...IT_STAFF),    c.list);
router.get('/stats',   requireRole(...IT_STAFF),    c.stats);
router.get('/:id',     requireRole(...IT_STAFF),    c.getOne);
// Only IT managers can create/edit/delete assets
router.post('/',       requireRole(...IT_MANAGERS), c.create);
router.patch('/:id',   requireRole(...IT_MANAGERS), c.update);
router.delete('/:id',  requireRole(...IT_MANAGERS), c.remove);

export { router as assetsRouter };
