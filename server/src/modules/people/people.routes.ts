import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS } from '../../middleware/authenticate';
import * as c from './people.controller';

const router = Router();
router.use(authenticate);

// Reading the directory is open to every role — scopedWhere() narrows it to
// what the caller may actually see, so an EMPLOYEE gets themselves and a
// manager gets their reports, without either being blocked at the route.
router.get('/',        requireRole(...ALL_USERS), c.list);
router.get('/stats',   requireRole(...ALL_USERS), c.stats);

// Adding people and managing their access is a manager action.
router.post('/',                  requireRole(...MANAGERS), c.create);
router.post('/:id/grant-login',   requireRole(...MANAGERS), c.grantLogin);
router.post('/:id/revoke-login',  requireRole(...MANAGERS), c.revokeLogin);
router.post('/:id/role',          requireRole(...MANAGERS), c.assignRole);
router.post('/repair-unlinked',   requireRole(...MANAGERS), c.repairUnlinked);

export { router as peopleRouter };
