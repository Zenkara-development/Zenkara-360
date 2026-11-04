import { Router } from 'express';
import { authenticate, requireRole, MANAGERS } from '../../../middleware/authenticate';
import { listAuditLogs } from './auditlog.controller';

const router = Router();
router.use(authenticate);

// Only managers can view audit logs
router.get('/', requireRole(...MANAGERS), listAuditLogs);

export { router as auditLogRouter };
