import { Router } from 'express';
import { authenticatePortal } from '../../middleware/authenticatePortal';
import * as c from './portal.controller';

const router = Router();

// Public
router.post('/request-access', c.requestAccess);
router.get('/verify', c.verifyToken);

// Portal-authenticated
router.get('/me', authenticatePortal, c.getMe);
router.get('/tickets', authenticatePortal, c.listTickets);
router.post('/tickets', authenticatePortal, c.createTicket);
router.get('/tickets/:id', authenticatePortal, c.getTicket);
router.get('/chat', authenticatePortal, c.getChatMessages);
router.post('/chat', authenticatePortal, c.sendChatMessage);

export { router as portalRouter };
