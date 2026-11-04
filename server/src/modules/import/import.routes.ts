import { Router } from 'express';
import { authenticate, requireRole, CRM_MANAGERS } from '../../middleware/authenticate';
import * as c from './import.controller';

const router = Router();
router.use(authenticate);

// Bulk imports are destructive — only CRM managers can run them
router.post('/contacts', requireRole(...CRM_MANAGERS), c.importContacts);
router.post('/leads',    requireRole(...CRM_MANAGERS), c.importLeads);

export { router as importRouter };
