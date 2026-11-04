import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF } from '../../../middleware/authenticate';
import * as c from './comments.controller';

export const commentsRouter = Router();
commentsRouter.use(authenticate);

// All staff (not employees) can view and add comments on tickets/deals
commentsRouter.get('/:entityType/:entityId',  requireRole(...ALL_STAFF), c.list);
commentsRouter.post('/:entityType/:entityId', requireRole(...ALL_STAFF), c.create);
commentsRouter.patch('/:id',                  requireRole(...ALL_STAFF), c.update);
commentsRouter.delete('/:id',                 requireRole(...ALL_STAFF), c.remove);
