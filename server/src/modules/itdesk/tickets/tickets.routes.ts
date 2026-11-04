import { Router } from 'express';
import { authenticate, requireRole,
         ALL_USERS, IT_STAFF, IT_MANAGERS } from '../../../middleware/authenticate';
import * as c from './tickets.controller';

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

// Anyone can create / view tickets (employees submit tickets; all staff view them)
ticketsRouter.get('/',               requireRole(...ALL_USERS),   c.list);
ticketsRouter.post('/',              requireRole(...ALL_USERS),   c.create);
ticketsRouter.get('/reports',        requireRole(...IT_MANAGERS), c.reports);
ticketsRouter.get('/:id',            requireRole(...ALL_USERS),   c.getOne);

// Only IT staff can update ticket content / status
ticketsRouter.patch('/:id',          requireRole(...IT_STAFF),    c.update);
ticketsRouter.patch('/:id/status',   requireRole(...IT_STAFF),    c.changeStatus);

// Only IT managers can reassign or delete
ticketsRouter.patch('/:id/assign',   requireRole(...IT_MANAGERS), c.assign);
ticketsRouter.delete('/:id',         requireRole(...IT_MANAGERS), c.remove);
