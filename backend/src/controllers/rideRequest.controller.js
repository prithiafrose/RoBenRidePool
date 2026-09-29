import { createRideRequest, listRideRequests } from '../services/rideRequest.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/ride-requests (protected by `authenticate` and `requireRole`) */
export const create = async (req, res) => {
  const rideRequest = await createRideRequest(req.user.id, req.body);

  return sendSuccess(res, { rideRequest }, 201, 'Ride request created successfully');
};

/** GET /api/ride-requests (protected by `authenticate` and `requireRole`) */
export const list = async (req, res) => {
  const rideRequests = await listRideRequests(req.user.id);

  return sendSuccess(res, { rideRequests }, 200, 'Ride requests retrieved successfully');
};
