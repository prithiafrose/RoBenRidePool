import { createRating } from '../services/rating.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/ratings (protected by `authenticate` and `requireRole`) */
export const create = async (req, res) => {
  // Only the two ids the client is allowed to name are forwarded. `raterId` and
  // `rateeId` are resolved from the authenticated identity and the pool in the
  // service, so nothing else the body contained could have reached the insert
  // even if `validateBody` were dropped from the route.
  const rating = await createRating(req.user.id, req.body);

  return sendSuccess(res, { rating }, 201, 'Rating created successfully');
};