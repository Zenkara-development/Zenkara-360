import { Router } from 'express';
import { authenticate, requireRole } from '../../../middleware/authenticate';
import * as c from './org.controller';

export const orgRouter = Router();
orgRouter.use(authenticate);
orgRouter.get('/', c.getOrg);
orgRouter.patch('/', requireRole('SUPER_ADMIN'), c.updateOrg);
orgRouter.get('/invites', requireRole('SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'), c.listInvites);
