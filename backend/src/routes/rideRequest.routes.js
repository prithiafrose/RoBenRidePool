import { Router } from 'express';

import {
  cancel,
  create,
  decline,
  getById,
  list,
  listAvailable,
} from '../controllers/rideRequest.controller.js';
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

/**
 * The driver's queue, mounted before `/:id` because `available` would otherwise be
 * read as an id. Express matches literal segments in registration order, so this
 * literal path has to come first; `validateParams` would turn the resulting 404
 * back into a 400, which is the wrong answer for a path that does exist.
 *
 * It is the only route in this router that takes a driver rather than a
 * passenger: the whole rest of the ride-request API is about a passenger's own
 * requests, while this one is the matching queue.
 */
router.get('/available', authenticate, requireRole('DRIVER'), listAvailable);

// Mounted last so it cannot shadow the collection routes above.
router.get(
  '/:id',
  authenticate,
  requireRole('PASSENGER'),
  validateParams(rideRequestIdParamSchema),
  getById,
);
// A PATCH cannot match the GET/POST collection routes above, since Express
// matches the method first, so ordering is for readability only.
router.patch(
  '/:id/cancel',
  authenticate,
  requireRole('PASSENGER'),
  validateParams(rideRequestIdParamSchema),
  cancel,
);
/**
 * The decline half of "accept or decline". It is a POST rather than a PATCH
 * because it records a new fact - this driver passed on this request - and
 * repeating it is a 409, not an idempotent re-write. `req.body` is not read, so
 * there is no `validateBody`: a decline takes no values from the client.
 */
router.post(
  '/:id/decline',
  authenticate,
  requireRole('DRIVER'),
  validateParams(rideRequestIdParamSchema),
  decline,
);

export default router;
