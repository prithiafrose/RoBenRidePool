import {
  cancelRideRequest,
  createRideRequest,
  declineRideRequest,
  getRideRequestById,
  listAvailableRideRequests,
  listRideRequests,
} from '../services/rideRequest.service.js';
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

/** GET /api/ride-requests/:id (protected by `authenticate` and `requireRole`) */
export const getById = async (req, res) => {
  const rideRequest = await getRideRequestById(req.user.id, req.params.id);

  return sendSuccess(res, { rideRequest }, 200, 'Ride request retrieved successfully');
};

/** PATCH /api/ride-requests/:id/cancel (protected by `authenticate` and `requireRole`) */
export const cancel = async (req, res) => {
  const rideRequest = await cancelRideRequest(req.user.id, req.params.id);

  return sendSuccess(res, { rideRequest }, 200, 'Ride request cancelled successfully');
};

/** GET /api/ride-requests/available (protected by `authenticate` and `requireRole`) */
export const listAvailable = async (req, res) => {
  // `req.user.id` is the only input. The queue this driver sees is filtered by
  // the `DriverProfile` resolved from that token, so there is no body, query or
  // params through which a client could widen it or decline-filter for somebody
  // else.
  const rideRequests = await listAvailableRideRequests(req.user.id);

  return sendSuccess(res, { rideRequests }, 200, 'Available ride requests retrieved successfully');
};

/** POST /api/ride-requests/:id/decline (protected by `authenticate` and `requireRole`) */
export const decline = async (req, res) => {
  // `req.body` is not forwarded: a decline names no values of its own. The
  // `driverId` is resolved from the token inside the service, and the request's
  // own `status` is never written - so the passenger's ride request is still
  // `WAITING` and still acceptable by another driver when this returns 201.
  const decline = await declineRideRequest(req.user.id, req.params.id);

  return sendSuccess(res, { decline }, 201, 'Ride request declined successfully');
};
