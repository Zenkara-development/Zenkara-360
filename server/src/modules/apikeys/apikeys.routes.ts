import { Router } from 'express';
import { authenticate, requireRole, ADMIN } from '../../middleware/authenticate';
import * as c from './apikeys.controller';

const router = Router();
router.use(authenticate);

// Only org admin can manage API keys
router.get('/',       requireRole(...ADMIN), c.listKeys);
router.post('/',      requireRole(...ADMIN), c.createKey);
router.delete('/:id', requireRole(...ADMIN), c.revokeKey);

export { router as apiKeysRouter };
