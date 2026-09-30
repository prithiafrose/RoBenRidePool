import { Router } from 'express';

import { create, read } from '../controllers/driverProfile.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createDriverProfileSchema } from '../validators/driverProfile.validator.js';

const router = Router();

/**
 * The dashboard needs to know the driver's own availability and vehicle before it
 * can render a truthful toggle, and there was no way to read either: the only
 * route here was the POST that creates them. It takes no path parameter, so the
 * profile is resolved from the access token and cannot be pointed at someone
 * else.
 */
router.get('/', authenticate, requireRole('DRIVER'), read);

router.post('/', authenticate, requireRole('DRIVER'), validateBody(createDriverProfileSchema), create);

export default router;
