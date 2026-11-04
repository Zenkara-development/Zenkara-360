import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS } from '../../middleware/authenticate';
import * as c from './knowledge.controller';

const router = Router();
router.use(authenticate);

// Retrieval is permission-aware inside the retriever, so it's safe to expose
// to every role — a user simply gets nothing back they aren't allowed to see.
router.post('/search', requireRole(...ALL_USERS), c.search);
router.post('/ask',    requireRole(...ALL_USERS), c.ask);
router.post('/feedback/:id', requireRole(...ALL_USERS), c.submitFeedback);

router.get('/documents',       requireRole(...MANAGERS), c.listDocuments);
router.post('/documents',      requireRole(...MANAGERS), c.createDocument);
router.delete('/documents/:id',requireRole(...MANAGERS), c.deleteDocument);
router.post('/reindex',        requireRole(...MANAGERS), c.reindex);
router.get('/stats',           requireRole(...MANAGERS), c.knowledgeStats);

// AI governance
router.get('/ai/observability', requireRole(...MANAGERS), c.observability);
router.get('/ai/logs',          requireRole(...MANAGERS), c.interactionLog);
router.get('/ai/budget',        requireRole(...MANAGERS), c.getBudget);
router.put('/ai/budget',        requireRole(...MANAGERS), c.setBudget);
router.get('/ai/providers',     requireRole(...MANAGERS), c.listProviders);
router.post('/ai/providers',    requireRole(...MANAGERS), c.createProvider);
router.delete('/ai/providers/:id', requireRole(...MANAGERS), c.deleteProvider);

export { router as knowledgeRouter };
