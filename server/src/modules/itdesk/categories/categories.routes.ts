import { Router } from 'express';
import { authenticate, requireRole,
         ALL_USERS, IT_MANAGERS } from '../../../middleware/authenticate';
import * as c from './categories.controller';

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

// Everyone needs to see categories when creating a ticket
categoriesRouter.get('/',       requireRole(...ALL_USERS),   c.list);
// Only IT managers can manage categories
categoriesRouter.post('/',      requireRole(...IT_MANAGERS), c.create);
categoriesRouter.patch('/:id',  requireRole(...IT_MANAGERS), c.update);
categoriesRouter.delete('/:id', requireRole(...IT_MANAGERS), c.remove);
