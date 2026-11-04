import { Router } from 'express';
import { authenticate, requireRole,
         CRM_STAFF, CRM_MANAGERS } from '../../../middleware/authenticate';
import * as c from './deals.controller';

export const dealsRouter = Router();
dealsRouter.use(authenticate);

dealsRouter.get('/',              requireRole(...CRM_STAFF),    c.list);
dealsRouter.post('/',             requireRole(...CRM_STAFF),    c.create);
dealsRouter.get('/pipeline',      requireRole(...CRM_STAFF),    c.pipeline);
dealsRouter.get('/reports',       requireRole(...CRM_MANAGERS), c.reports);
dealsRouter.get('/:id',           requireRole(...CRM_STAFF),    c.getOne);
dealsRouter.patch('/:id',         requireRole(...CRM_STAFF),    c.update);
dealsRouter.patch('/:id/stage',   requireRole(...CRM_STAFF),    c.moveStage);
dealsRouter.delete('/:id',        requireRole(...CRM_MANAGERS), c.remove);
