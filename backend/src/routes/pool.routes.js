import { Router } from 'express';

import {
  addMember,
  complete,
  create,
  getById,
  list,
  start,
} from '../controllers/pool.controller.js';
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

// Collection route mounted first, mirroring `rideRequest.routes.js`: it reads no
// params and no body, so it needs neither `validateParams` nor `validateBody`.
router.get('/', authenticate, requireRole('DRIVER'), list);

// Mounted after the collection route and before the two-segment paths below.
// `GET /api/pools/:poolId` is the driver's read of one pool with its members,
// which is what lets them follow a ride they are serving.
router.get(
  '/:poolId',
  authenticate,
  requireRole('DRIVER'),
  validateParams(poolIdParamSchema),
  getById,
);

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
