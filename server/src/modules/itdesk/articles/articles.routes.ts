import { Router } from 'express';
import { authenticate, requireRole,
         ALL_USERS, IT_STAFF } from '../../../middleware/authenticate';
import * as c from './articles.controller';

export const articlesRouter = Router();
articlesRouter.use(authenticate);

// Everyone can read KB articles
articlesRouter.get('/',       requireRole(...ALL_USERS), c.list);
// Registered before GET /:id — otherwise Express matches "suggest" as an :id.
articlesRouter.get('/suggest', requireRole(...ALL_USERS), c.suggest);
articlesRouter.get('/:id',    requireRole(...ALL_USERS), c.getOne);
// IT staff (agents + managers) can create/edit/delete
articlesRouter.post('/',      requireRole(...IT_STAFF),  c.create);
articlesRouter.patch('/:id',  requireRole(...IT_STAFF),  c.update);
articlesRouter.delete('/:id', requireRole(...IT_STAFF),  c.remove);
