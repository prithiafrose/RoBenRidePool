import { Router } from 'express';

import { create, getById, list } from '../controllers/rideRequest.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody, validateParams } from '../middleware/validate.middleware.js';
import {
  createRideRequestSchema,
  rideRequestIdParamSchema,
} from '../validators/rideRequest.validator.js';

const router = Router();

router.get('/', authenticate, requireRole('PASSENGER'), list);
router.post('/', authenticate, requireRole('PASSENGER'), validateBody(createRideRequestSchema), create);
// Mounted last so it cannot shadow the collection routes above.
router.get(
  '/:id',
  authenticate,
  requireRole('PASSENGER'),
  validateParams(rideRequestIdParamSchema),
  getById,
);

export default router;
