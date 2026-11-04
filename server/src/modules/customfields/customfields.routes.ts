import { Router } from 'express';
import { authenticate, requireRole,
         ALL_USERS, ALL_STAFF, MANAGERS } from '../../middleware/authenticate';
import * as c from './customfields.controller';

const router = Router();
router.use(authenticate);

// Field definitions: everyone can read, only managers can manage
router.get('/',           requireRole(...ALL_USERS),  c.listFields);
router.post('/',          requireRole(...MANAGERS),   c.createField);
router.patch('/:id',      requireRole(...MANAGERS),   c.updateField);
router.delete('/:id',     requireRole(...MANAGERS),   c.deleteField);

// Field values: all staff can read and set values on entities
router.get('/values/:entityId',  requireRole(...ALL_STAFF), c.getValues);
router.post('/values/:entityId', requireRole(...ALL_STAFF), c.setValues);

export { router as customFieldsRouter };
