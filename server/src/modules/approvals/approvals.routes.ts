import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS } from '../../middleware/authenticate';
import * as c from './approvals.controller';

const router = Router();
router.use(authenticate);

// Policies are configuration — managers only.
router.get('/policies',        requireRole(...MANAGERS),  c.listPolicies);
router.post('/policies',       requireRole(...MANAGERS),  c.createPolicy);
router.patch('/policies/:id',  requireRole(...MANAGERS),  c.updatePolicy);
router.delete('/policies/:id', requireRole(...MANAGERS),  c.deletePolicy);

// Requests: anyone can raise one and anyone named as an approver can decide.
// decideRequest re-checks approver membership itself — the route guard is not
// what protects it.
router.get('/requests',            requireRole(...ALL_USERS), c.listRequests);
router.get('/requests/my-pending', requireRole(...ALL_USERS), c.myPending);
router.get('/requests/:id',        requireRole(...ALL_USERS), c.getRequest);
router.post('/requests',           requireRole(...ALL_USERS), c.createRequest);
router.post('/requests/:id/decide',requireRole(...ALL_USERS), c.decideRequest);
router.post('/requests/:id/cancel',requireRole(...ALL_USERS), c.cancelRequest);

// Delegations
router.get('/delegations',        requireRole(...ALL_USERS), c.listDelegations);
router.post('/delegations',       requireRole(...ALL_USERS), c.createDelegation);
router.delete('/delegations/:id', requireRole(...ALL_USERS), c.revokeDelegation);

export { router as approvalsRouter };
