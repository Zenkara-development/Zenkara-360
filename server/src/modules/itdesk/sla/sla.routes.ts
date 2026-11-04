import { Router } from 'express';
import { authenticate, requireRole,
         IT_STAFF, IT_MANAGERS } from '../../../middleware/authenticate';
import * as c from './sla.controller';

export const slaRouter = Router();
slaRouter.use(authenticate);

// IT staff can view SLA policies
slaRouter.get('/',       requireRole(...IT_STAFF),    c.list);
// Only IT managers can manage SLA policies
slaRouter.post('/',      requireRole(...IT_MANAGERS), c.create);
slaRouter.patch('/:id',  requireRole(...IT_MANAGERS), c.update);
slaRouter.delete('/:id', requireRole(...IT_MANAGERS), c.remove);
