import { Router } from 'express';
import { authenticate, requireRole,
         CRM_STAFF, CRM_MANAGERS } from '../../../middleware/authenticate';
import * as c from './contacts.controller';

export const contactsRouter = Router();
contactsRouter.use(authenticate);

contactsRouter.get('/',       requireRole(...CRM_STAFF),    c.list);
contactsRouter.post('/',      requireRole(...CRM_STAFF),    c.create);
contactsRouter.get('/:id',    requireRole(...CRM_STAFF),    c.getOne);
contactsRouter.patch('/:id',  requireRole(...CRM_STAFF),    c.update);
// Only managers can delete contacts
contactsRouter.delete('/:id', requireRole(...CRM_MANAGERS), c.remove);
