import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF } from '../../../middleware/authenticate';
import { relatedForEntity } from './related.controller';

const router = Router();
router.use(authenticate);

// Read-only aggregation over records the caller could list individually
// anyway — ALL_STAFF, matching the loosest of the underlying list routes.
router.get('/:entityType/:id', requireRole(...ALL_STAFF), relatedForEntity);

export { router as relatedRouter };
