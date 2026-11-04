import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF, MANAGERS } from '../../middleware/authenticate';
import * as c from './tags.controller';

export const tagsRouter = Router();
tagsRouter.use(authenticate);

// Managing the tag library (renaming, recolouring, deleting, merging) changes
// what everyone else sees, so it is manager-only. Applying an existing tag —
// or coining a new one from the tag input — is everyday work for all staff.
tagsRouter.get('/',                  requireRole(...ALL_STAFF), c.list);
tagsRouter.post('/',                 requireRole(...MANAGERS),  c.create);
tagsRouter.post('/merge',            requireRole(...MANAGERS),  c.merge);
tagsRouter.patch('/:id',             requireRole(...MANAGERS),  c.update);
tagsRouter.delete('/:id',            requireRole(...MANAGERS),  c.remove);
tagsRouter.get('/:id/records',       requireRole(...ALL_STAFF), c.records);

// Per-record routes. Registered after the single-segment ones above so
// `/merge` is never read as a `:entityType`, and `/:id/records` is never read
// as `/:entityType/:entityId` — Express matches in registration order.
tagsRouter.get('/record/:entityType/:entityId',            requireRole(...ALL_STAFF), c.listForRecord);
tagsRouter.post('/record/:entityType/:entityId',           requireRole(...ALL_STAFF), c.attach);
tagsRouter.delete('/record/:entityType/:entityId/:tagId',  requireRole(...ALL_STAFF), c.detach);
