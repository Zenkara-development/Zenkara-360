import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/authenticate';
import * as c from './platformAdmin.controller';

export const platformAdminRouter = Router();

// No authenticate() — secret-header-gated instead, see bootstrap().
platformAdminRouter.post('/bootstrap', c.bootstrap);

platformAdminRouter.use(authenticate, requireRole('PLATFORM_ADMIN'));
platformAdminRouter.get('/orgs', c.listOrgs);
platformAdminRouter.get('/orgs/:id', c.getOrg);
platformAdminRouter.patch('/orgs/:id', c.updateOrg);
platformAdminRouter.patch('/orgs/:id/subscription', c.updateSubscription);
platformAdminRouter.patch('/orgs/:id/branding', c.updateBranding);
platformAdminRouter.get('/settings', c.getSettings);
platformAdminRouter.patch('/settings', c.updateSettings);
platformAdminRouter.post('/settings/storage/test', c.testStorage);
platformAdminRouter.get('/pricing', c.getPricing);
platformAdminRouter.put('/pricing', c.updatePricing);
platformAdminRouter.delete('/pricing', c.resetPricing);
