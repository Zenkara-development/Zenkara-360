import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/authenticate';
import * as c from './gdpr.controller';

const router = Router();
router.use(authenticate);

router.get('/export/me', c.exportMyData);
router.post('/delete-request/me', c.deleteMyData);

router.get('/export/org', requireRole('SUPER_ADMIN'), c.exportOrgData);
router.post('/anonymize/:userId', requireRole('SUPER_ADMIN'), c.anonymizeUser);

export { router as gdprRouter };
