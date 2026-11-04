import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF, MANAGERS } from '../../middleware/authenticate';
import * as c from './replyTemplates.controller';

const router = Router();
router.use(authenticate);

// All staff can read/use canned responses; only managers curate the list.
router.get('/',       requireRole(...ALL_STAFF), c.list);
router.post('/',      requireRole(...MANAGERS),  c.create);
router.patch('/:id',  requireRole(...MANAGERS),  c.update);
router.delete('/:id', requireRole(...MANAGERS),  c.remove);

export { router as replyTemplatesRouter };
