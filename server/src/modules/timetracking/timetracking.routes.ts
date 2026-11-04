import { Router } from 'express';
import { authenticate, requireRole, IT_STAFF } from '../../middleware/authenticate';
import * as c from './timetracking.controller';

const router = Router({ mergeParams: true });
router.use(authenticate);

// All IT staff can log and view time on tickets
router.get('/:ticketId',              requireRole(...IT_STAFF), c.listEntries);
router.post('/:ticketId',             requireRole(...IT_STAFF), c.logTime);
router.delete('/:ticketId/:entryId',  requireRole(...IT_STAFF), c.deleteEntry);

export { router as timeTrackingRouter };
