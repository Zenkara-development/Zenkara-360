import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS } from '../../middleware/authenticate';
import * as c from './workspace.controller';

const router = Router();
router.use(authenticate);

// Every signed-in user renders the sidebar, so reads are open to all roles.
router.get('/config', requireRole(...ALL_USERS), c.getWorkspaceConfig);
// Reshaping the workspace is an org-settings act — same tier as Branding.
router.put('/config', requireRole(...MANAGERS), c.saveWorkspaceConfig);

export { router as workspaceRouter };
