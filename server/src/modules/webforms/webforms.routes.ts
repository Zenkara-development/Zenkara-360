import { Router } from 'express';
import { authenticate, requireRole, MANAGERS } from '../../middleware/authenticate';
import * as c from './webforms.controller';

// Public — no auth: these are embedded on the org's own website.
export const publicFormsRouter = Router();
publicFormsRouter.get('/:id', c.publicFormMeta);
publicFormsRouter.post('/:id/submit', c.publicFormSubmit);

// Admin — creating/managing forms is an org-settings act.
export const webFormsRouter = Router();
webFormsRouter.use(authenticate);
webFormsRouter.get('/', requireRole(...MANAGERS), c.listForms);
webFormsRouter.post('/', requireRole(...MANAGERS), c.createForm);
webFormsRouter.patch('/:id', requireRole(...MANAGERS), c.updateForm);
webFormsRouter.post('/:id/rotate-token', requireRole(...MANAGERS), c.rotateToken);
webFormsRouter.delete('/:id', requireRole(...MANAGERS), c.deleteForm);
