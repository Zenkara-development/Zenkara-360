import { Router } from 'express';
import { authenticate, requireRole,
         IT_MANAGERS, CRM_MANAGERS } from '../../../middleware/authenticate';
import { requireFeature } from '../../../utils/licensing';
import { ticketReports, crmReports } from './reports.controller';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const advancedAnalytics = requireFeature('advanced_analytics');
reportsRouter.get('/tickets', requireRole(...IT_MANAGERS),  advancedAnalytics, ticketReports);
reportsRouter.get('/crm',     requireRole(...CRM_MANAGERS), advancedAnalytics, crmReports);
