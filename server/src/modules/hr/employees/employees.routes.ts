import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS } from '../../../middleware/authenticate';
import * as c from './employees.controller';

const router = Router();
router.use(authenticate);

// Route-level guards stay coarse on purpose. The real authorization for this
// module is the permission engine inside each handler (assertCan + scopedWhere
// + redact) — requireRole here only keeps obviously-wrong roles out early. An
// EMPLOYEE reaching GET /employees is fine: scopedWhere narrows it to
// themselves. That layering is what lets a customer widen or narrow access as
// data without a deploy.
router.get('/me',            requireRole(...ALL_USERS), c.me);
router.get('/org-chart',     requireRole(...ALL_USERS), c.orgChart);
router.get('/stats',         requireRole(...ALL_USERS), c.stats);
router.get('/expiring',      requireRole(...ALL_USERS), c.expiringSoon);
router.get('/',              requireRole(...ALL_USERS), c.list);
router.get('/:id',           requireRole(...ALL_USERS), c.getOne);
router.get('/:id/reports',   requireRole(...ALL_USERS), c.directReports);

router.post('/',             requireRole(...MANAGERS),  c.create);
router.patch('/:id',         requireRole(...ALL_USERS), c.update);
router.post('/:id/exit',     requireRole(...MANAGERS),  c.recordExit);
router.delete('/:id',        requireRole(...MANAGERS),  c.remove);

router.post('/:id/contacts',       requireRole(...ALL_USERS), c.addContact);
router.post('/:id/skills',         requireRole(...ALL_USERS), c.addSkill);
router.post('/:id/certifications', requireRole(...ALL_USERS), c.addCertification);

export { router as employeesRouter };
