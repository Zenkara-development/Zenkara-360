import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS, ADMIN } from '../../middleware/authenticate';
import * as c from './permissions.controller';

const router = Router();
router.use(authenticate);

// Every user may read their own effective permissions — the client needs this
// to decide what to render, and it exposes nothing they don't already have.
router.get('/me', requireRole(...ALL_USERS), c.myPermissions);

router.get('/catalog', requireRole(...MANAGERS), c.listPermissions);
router.get('/roles',   requireRole(...MANAGERS), c.listRoles);

// Editing roles is admin-only, and assertNoEscalation() inside each handler
// stops an admin minting a role above their own rank.
router.post('/roles',        requireRole(...ADMIN), c.createRole);
router.patch('/roles/:id',   requireRole(...ADMIN), c.updateRole);
router.delete('/roles/:id',  requireRole(...ADMIN), c.deleteRole);
router.post('/roles/:id/fields', requireRole(...ADMIN), c.setFieldPermission);
router.delete('/roles/:id/fields/:fieldPermissionId', requireRole(...ADMIN), c.deleteFieldPermission);
router.post('/assign',       requireRole(...ADMIN), c.assignRole);
router.post('/reseed',       requireRole(...ADMIN), c.reseed);

export { router as permissionsRouter };
