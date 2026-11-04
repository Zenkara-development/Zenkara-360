import { Router } from 'express';
import { authenticate, requireRole,
         CRM_STAFF, CRM_MANAGERS } from '../../../middleware/authenticate';
import * as c from './activities.controller';

export const activitiesRouter = Router();
activitiesRouter.use(authenticate);

activitiesRouter.get('/',       requireRole(...CRM_STAFF),    c.list);
activitiesRouter.post('/',      requireRole(...CRM_STAFF),    c.create);
activitiesRouter.patch('/:id',  requireRole(...CRM_STAFF),    c.update);
activitiesRouter.delete('/:id', requireRole(...CRM_MANAGERS), c.remove);
