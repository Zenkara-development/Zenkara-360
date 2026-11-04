import { Router } from 'express';
import { authenticate, requireRole, IT_MANAGERS } from '../../middleware/authenticate';
import * as c from './csat.controller';

const router = Router();

// Public: customer feedback page + submission, reached from the emailed
// CSAT survey link (no auth). GET renders the form (no DB writes — see
// csat.controller.ts's file-level comment on why); POST is the form's own
// target and records the rating/comment.
router.get('/submit/:ticketId', c.showForm);
router.post('/submit/:ticketId', c.submitRating);

router.use(authenticate);
// Only IT managers can view CSAT analytics
router.get('/',       requireRole(...IT_MANAGERS), c.listResponses);
router.get('/stats',  requireRole(...IT_MANAGERS), c.csatStats);

export { router as csatRouter };
