import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import * as c from './totp.controller';

const router = Router();
router.use(authenticate);
router.get('/status', c.getStatus);
router.post('/setup', c.setupTotp);
router.post('/enable', c.enableTotp);
router.post('/disable', c.disableTotp);

export { router as totpRouter };
