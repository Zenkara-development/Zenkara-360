import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS } from '../../middleware/authenticate';
import * as c from './tasks.controller';

const router = Router();
router.use(authenticate);

// Tasks are universal — every authenticated role has some. Scope is enforced
// per-record by the permission engine, not by keeping roles off the route.
router.get('/my-work',    requireRole(...ALL_USERS), c.myWork);
router.get('/stats',      requireRole(...ALL_USERS), c.stats);
router.get('/',           requireRole(...ALL_USERS), c.list);
router.get('/:id',        requireRole(...ALL_USERS), c.getOne);
router.post('/',          requireRole(...ALL_USERS), c.create);
router.post('/bulk',      requireRole(...ALL_USERS), c.bulkUpdate);
router.patch('/:id',      requireRole(...ALL_USERS), c.update);
router.patch('/:id/checklist', requireRole(...ALL_USERS), c.toggleChecklistItem);
router.delete('/:id',     requireRole(...ALL_USERS), c.remove);

export { router as tasksRouter };
