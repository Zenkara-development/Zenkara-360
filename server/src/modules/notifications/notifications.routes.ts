import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import * as c from './notifications.controller';

const router = Router();

router.use(authenticate);
router.get('/', c.listNotifications);
router.patch('/:id/read', c.markRead);
router.post('/read-all', c.markAllRead);

export { router as notificationsRouter };
