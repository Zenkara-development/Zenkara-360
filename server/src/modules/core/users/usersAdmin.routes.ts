import { Router } from 'express';
import { authenticate, requireRole } from '../../../middleware/authenticate';
import * as c from './usersAdmin.controller';

export const usersAdminRouter = Router();
usersAdminRouter.use(authenticate, requireRole('SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'));
usersAdminRouter.get('/', c.list);
usersAdminRouter.post('/', c.create);
usersAdminRouter.post('/invite', c.invite);
usersAdminRouter.patch('/:id', c.update);
usersAdminRouter.delete('/:id', c.deactivate);
usersAdminRouter.post('/:id/reset-password', c.resetUserPassword);
// Registered before the /:id routes above would ever shadow it — 'reconcile-
// employees' is a literal path, not an id, so ordering matters here.
usersAdminRouter.post('/reconcile-employees', c.reconcileEmployees);
usersAdminRouter.post('/:id/link-employee', c.linkEmployee);
