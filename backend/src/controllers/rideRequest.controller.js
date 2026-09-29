import { createRideRequest } from '../services/rideRequest.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/ride-requests (protected by `authenticate` and `requireRole`) */
export const create = async (req, res) => {
  const rideRequest = await createRideRequest(req.user.id, req.body);

  return sendSuccess(res, { rideRequest }, 201, 'Ride request created successfully');
};
