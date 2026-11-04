import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF } from '../../middleware/authenticate';
import * as c from './schedules.controller';

export const schedulesRouter = Router();
schedulesRouter.use(authenticate);

// Any staff role can schedule a reminder on a record they can already see —
// same access level as commenting on a ticket/deal, not gated to managers.
schedulesRouter.get('/upcoming',  requireRole(...ALL_STAFF), c.listUpcoming);
schedulesRouter.get('/',          requireRole(...ALL_STAFF), c.list);
schedulesRouter.post('/',         requireRole(...ALL_STAFF), c.create);
schedulesRouter.delete('/:id',    requireRole(...ALL_STAFF), c.cancel);
