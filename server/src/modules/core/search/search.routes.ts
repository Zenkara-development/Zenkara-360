import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF } from '../../../middleware/authenticate';
import { search } from './search.controller';

export const searchRouter = Router();
searchRouter.use(authenticate);

// Global search is for all staff (not employees)
searchRouter.get('/', requireRole(...ALL_STAFF), search);
