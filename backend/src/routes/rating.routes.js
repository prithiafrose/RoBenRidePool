import { Router } from 'express';

import { create } from '../controllers/rating.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createRatingSchema } from '../validators/rating.validator.js';

const router = Router();

// Both parties score the other, so this is the first route in the API that is
// not single-role. Which direction applies is decided in the service from the
// caller's relationship to the pool, not by branching on the role here.
router.post(
  '/',
  authenticate,
  requireRole('PASSENGER', 'DRIVER'),
  validateBody(createRatingSchema),
  create,
);

export default router;