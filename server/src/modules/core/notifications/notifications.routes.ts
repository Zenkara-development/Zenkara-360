// ORPHANED / DEAD FILE — not imported or mounted anywhere.
//
// The real, active notification center lives in
// `server/src/modules/notifications/notifications.routes.ts` and is mounted
// at `/api/notifications` in `server/src/index.ts`. This early stub predates
// that module and was never wired in — safe to delete this whole
// `core/notifications` directory. (Left in place only because this
// environment's filesystem mount didn't allow deleting/renaming files;
// please remove it directly on your machine.)
import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get('/', (_req, res) => res.json({ message: 'notifications endpoint — coming in Phase 1' }));
