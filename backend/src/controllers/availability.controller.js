import { setDriverAvailability } from '../services/driverProfile.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/availability (protected by `authenticate` and `requireRole`) */
export const setAvailability = async (req, res) => {
  // Only the one value the client is allowed to name is forwarded. The profile
  // is resolved from the authenticated identity in the service, so `userId` and
  // `driverId` never travel from the HTTP layer into the update.
  const driverProfile = await setDriverAvailability(req.user.id, req.body.status);

  return sendSuccess(res, { driverProfile }, 200, 'Driver availability updated successfully');
};