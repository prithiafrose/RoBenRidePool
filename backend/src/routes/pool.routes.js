import { Router } from 'express';

import { addMember, complete, create, start } from '../controllers/pool.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody, validateParams } from '../middleware/validate.middleware.js';
import {
  addPoolMemberSchema,
  createPoolSchema,
  poolIdParamSchema,
  poolLifecycleSchema,
} from '../validators/pool.validator.js';

const router = Router();

router.post('/', authenticate, requireRole('DRIVER'), validateBody(createPoolSchema), create);

router.post(
  '/:poolId/members',
  authenticate,
  requireRole('DRIVER'),
  validateParams(poolIdParamSchema),
  validateBody(addPoolMemberSchema),
  addMember,
);

// The two lifecycle transitions share their guards, their path validation and
// their empty-body schema, and differ only in the service they call. They are
// mounted as literal paths rather than a generic `/:poolId/status`, so an
// illegal transition cannot be named in a request at all.
router.patch(
  '/:poolId/start',
  authenticate,
  requireRole('DRIVER'),
  validateParams(poolIdParamSchema),
  validateBody(poolLifecycleSchema),
  start,
);

router.patch(
  '/:poolId/complete',
  authenticate,
  requireRole('DRIVER'),
  validateParams(poolIdParamSchema),
  validateBody(poolLifecycleSchema),
  complete,
);

export default router;
