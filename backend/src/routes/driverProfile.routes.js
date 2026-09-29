import { Router } from 'express';

import { create } from '../controllers/driverProfile.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createDriverProfileSchema } from '../validators/driverProfile.validator.js';

const router = Router();

router.post('/', authenticate, requireRole('DRIVER'), validateBody(createDriverProfileSchema), create);

export default router;
