import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import * as push from './push.controller';

const router = Router();

router.use(authenticate);
router.get('/vapid-public-key', push.getVapidKey);
router.post('/subscribe', push.subscribe);
router.post('/unsubscribe', push.unsubscribe);

export { router as pushRouter };
