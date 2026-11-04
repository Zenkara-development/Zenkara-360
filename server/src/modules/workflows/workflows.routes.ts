import { Router } from 'express';
import { authenticate, requireRole, MANAGERS } from '../../middleware/authenticate';
import { requireFeature } from '../../utils/licensing';
import * as wf from './workflows.controller';

export const workflowsRouter = Router();
workflowsRouter.use(authenticate);

// Only managers can manage automation rules. Workflow automation is a Pro+
// feature (utils/licensing.ts), but only gated on *creating new* rules —
// existing rules from a since-downgraded org keep running (the engine
// itself doesn't check plan), matching the seat-limit grandfathering
// policy: block new usage, never revoke what's already there.
workflowsRouter.get('/',              requireRole(...MANAGERS), wf.list);
workflowsRouter.post('/',             requireRole(...MANAGERS), requireFeature('workflow_automation'), wf.create);
workflowsRouter.put('/:id',           requireRole(...MANAGERS), wf.update);
workflowsRouter.delete('/:id',        requireRole(...MANAGERS), wf.remove);
workflowsRouter.get('/:id/logs',      requireRole(...MANAGERS), wf.getLogs);
workflowsRouter.patch('/:id/toggle',  requireRole(...MANAGERS), wf.toggleActive);
workflowsRouter.post('/:id/run-now',  requireRole(...MANAGERS), wf.runDateRule);
