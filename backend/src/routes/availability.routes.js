import { Router } from 'express';

import { setAvailability } from '../controllers/availability.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { setAvailabilitySchema } from '../validators/availability.validator.js';

const router = Router();

router.post(
  '/',
  authenticate,
  requireRole('DRIVER'),
  validateBody(setAvailabilitySchema),
  setAvailability,
);

export default router;