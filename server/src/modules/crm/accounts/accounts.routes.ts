import { Router } from 'express';
import { authenticate, requireRole,
         CRM_STAFF, CRM_MANAGERS } from '../../../middleware/authenticate';
import * as c from './accounts.controller';

export const accountsRouter = Router();
accountsRouter.use(authenticate);

accountsRouter.get('/',       requireRole(...CRM_STAFF),    c.list);
accountsRouter.post('/',      requireRole(...CRM_STAFF),    c.create);
accountsRouter.get('/:id',    requireRole(...CRM_STAFF),    c.getOne);
accountsRouter.patch('/:id',  requireRole(...CRM_STAFF),    c.update);
accountsRouter.delete('/:id', requireRole(...CRM_MANAGERS), c.remove);
