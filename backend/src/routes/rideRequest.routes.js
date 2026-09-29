import { Router } from 'express';

import { create, list } from '../controllers/rideRequest.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createRideRequestSchema } from '../validators/rideRequest.validator.js';

const router = Router();

router.get('/', authenticate, requireRole('PASSENGER'), list);
router.post('/', authenticate, requireRole('PASSENGER'), validateBody(createRideRequestSchema), create);

export default router;
