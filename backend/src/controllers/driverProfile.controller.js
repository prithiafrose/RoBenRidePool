import { createDriverProfile, getDriverProfile } from '../services/driverProfile.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** GET /api/driver-profile (protected by `authenticate` and `requireRole`) */
export const read = async (req, res) => {
  // `req.user.id` is the only input. There is no path parameter or body to
  // forward, so the profile the service returns is always the caller's own.
  const driverProfile = await getDriverProfile(req.user.id);

  return sendSuccess(res, { driverProfile }, 200, 'Driver profile retrieved successfully');
};

/** POST /api/driver-profile (protected by `authenticate` and `requireRole`) */
export const create = async (req, res) => {
  const driverProfile = await createDriverProfile(req.user.id, req.body);

  return sendSuccess(res, { driverProfile }, 201, 'Driver profile created successfully');
};
