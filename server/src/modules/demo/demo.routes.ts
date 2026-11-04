import { Router } from 'express';
import { resetDemo, listVerticals, demoStatus, seedMissing } from './demo.controller';
import { authenticate } from '../../middleware/authenticate';

export const demoRouter = Router();
// No authenticate() middleware — secret-header-gated instead, see resetDemo().
demoRouter.post('/reset', resetDemo);
// Public — the /demo landing page needs this before anyone is logged in.
demoRouter.get('/verticals', listVerticals);
// Public diagnostics — tells you whether the demo is seeded and what to run if
// it isn't, without needing a login you may not be able to get.
demoRouter.get('/status', demoStatus);

// Creates only the demo orgs that are missing — non-destructive, so it accepts
// a signed-in admin as well as the reset secret. `authenticate` is applied
// leniently: a request carrying the secret and no token must still get through.
demoRouter.post('/seed-missing', (req, res, next) => {
  if (req.header('x-demo-reset-secret')) return next();
  return authenticate(req as never, res, next);
}, seedMissing);
