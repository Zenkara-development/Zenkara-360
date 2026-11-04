import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF, MANAGERS } from '../../middleware/authenticate';
import * as c from './recordTemplates.controller';

const router = Router();
router.use(authenticate);

// Everyone who creates records can read templates to pre-fill a form;
// only managers can define/edit/delete templates.
router.get('/',       requireRole(...ALL_STAFF), c.list);
router.get('/:id',    requireRole(...ALL_STAFF), c.getOne);
router.post('/',      requireRole(...MANAGERS),  c.create);
router.patch('/:id',  requireRole(...MANAGERS),  c.update);
router.delete('/:id', requireRole(...MANAGERS),  c.remove);

export { router as recordTemplatesRouter };
