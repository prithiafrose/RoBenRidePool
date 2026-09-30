import { addPoolMember, createPool } from '../services/pool.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/pools (protected by `authenticate` and `requireRole`) */
export const create = async (req, res) => {
  // `req.body` is not forwarded: the pool's driver and vehicle are resolved
  // from the authenticated identity alone.
  const pool = await createPool(req.user.id);

  return sendSuccess(res, { pool }, 201, 'Pool created successfully');
};

/** POST /api/pools/:poolId/members (protected by `authenticate` and `requireRole`) */
export const addMember = async (req, res) => {
  // Only the two ids the client is allowed to name are forwarded. The seats and
  // the fare are read off the RideRequest by the service, so nothing else the
  // body contained could have reached the insert even if `validateBody` were
  // dropped from the route.
  const poolMember = await addPoolMember(req.user.id, req.params.poolId, req.body.rideRequestId);

  return sendSuccess(res, { poolMember }, 201, 'Ride request added to pool successfully');
};
