import { Router } from 'express';
import { authenticate, requireRole, CRM_STAFF, CRM_MANAGERS } from '../../../middleware/authenticate';
import * as c from './pipelines.controller';

export const pipelinesRouter = Router();
pipelinesRouter.use(authenticate);

pipelinesRouter.get('/',                        requireRole(...CRM_STAFF),    c.list);
pipelinesRouter.get('/:id',                      requireRole(...CRM_STAFF),    c.getOne);
pipelinesRouter.patch('/:id',                    requireRole(...CRM_MANAGERS), c.rename);
pipelinesRouter.post('/:id/stages',              requireRole(...CRM_MANAGERS), c.addStage);
pipelinesRouter.patch('/:id/stages/:label',      requireRole(...CRM_MANAGERS), c.updateStage);
pipelinesRouter.delete('/:id/stages/:label',     requireRole(...CRM_MANAGERS), c.removeStage);
pipelinesRouter.post('/:id/stages/reorder',      requireRole(...CRM_MANAGERS), c.reorderStages);
