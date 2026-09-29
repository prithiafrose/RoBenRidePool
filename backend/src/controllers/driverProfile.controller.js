import { createDriverProfile } from '../services/driverProfile.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/driver-profile (protected by `authenticate` and `requireRole`) */
export const create = async (req, res) => {
  const driverProfile = await createDriverProfile(req.user.id, req.body);

  return sendSuccess(res, { driverProfile }, 201, 'Driver profile created successfully');
};
