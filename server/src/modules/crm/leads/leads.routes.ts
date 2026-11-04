import { Router } from 'express';
import { authenticate, requireRole,
         CRM_STAFF, CRM_MANAGERS } from '../../../middleware/authenticate';
import * as c from './leads.controller';

export const leadsRouter = Router();
leadsRouter.use(authenticate);

leadsRouter.get('/',              requireRole(...CRM_STAFF),    c.list);
leadsRouter.post('/',             requireRole(...CRM_STAFF),    c.create);
leadsRouter.get('/:id',           requireRole(...CRM_STAFF),    c.getOne);
leadsRouter.patch('/:id',         requireRole(...CRM_STAFF),    c.update);
leadsRouter.patch('/:id/convert', requireRole(...CRM_STAFF),    c.convert);
leadsRouter.delete('/:id',        requireRole(...CRM_MANAGERS), c.remove);
