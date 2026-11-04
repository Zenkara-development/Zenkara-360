import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS } from '../../middleware/authenticate';
import * as c from './chat.controller';

// Every authenticated org member can chat — chat is for employees, not a
// staff-tier feature. Access to individual threads is enforced per-thread
// in the controller (DM membership; record threads join implicitly).
export const chatRouter = Router();
chatRouter.use(authenticate);

chatRouter.get('/threads',                        requireRole(...ALL_USERS), c.listThreads);
chatRouter.get('/people',                         requireRole(...ALL_USERS), c.listPeople);
chatRouter.post('/dm',                            requireRole(...ALL_USERS), c.openDm);
chatRouter.get('/record/:entityType/:entityId',   requireRole(...ALL_USERS), c.openRecordThread);
chatRouter.get('/threads/:id/messages',           requireRole(...ALL_USERS), c.listMessages);
chatRouter.post('/threads/:id/messages',          requireRole(...ALL_USERS), c.postMessage);
