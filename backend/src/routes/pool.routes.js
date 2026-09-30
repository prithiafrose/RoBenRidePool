import { Router } from 'express';

import { addMember, create } from '../controllers/pool.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { validateBody, validateParams } from '../middleware/validate.middleware.js';
import { addPoolMemberSchema, createPoolSchema, poolIdParamSchema } from '../validators/pool.validator.js';

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

export default router;
