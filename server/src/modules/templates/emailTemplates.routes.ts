import { Router } from 'express';
import { authenticate, requireRole, CRM_STAFF, CRM_MANAGERS } from '../../middleware/authenticate';
import * as c from './emailTemplates.controller';

const router = Router();
router.use(authenticate);

// CRM staff can read/use email templates when composing a campaign;
// only managers curate the template list.
router.get('/',       requireRole(...CRM_STAFF),    c.list);
router.post('/',      requireRole(...CRM_MANAGERS), c.create);
router.patch('/:id',  requireRole(...CRM_MANAGERS), c.update);
router.delete('/:id', requireRole(...CRM_MANAGERS), c.remove);

export { router as emailTemplatesRouter };
