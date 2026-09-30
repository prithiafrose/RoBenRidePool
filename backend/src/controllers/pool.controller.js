import { addPoolMember, completePool, createPool, listPools, startPool } from '../services/pool.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/pools (protected by `authenticate` and `requireRole`) */
export const create = async (req, res) => {
  // `req.body` is not forwarded: the pool's driver and vehicle are resolved
  // from the authenticated identity alone.
  const pool = await createPool(req.user.id);

  return sendSuccess(res, { pool }, 201, 'Pool created successfully');
};

/** GET /api/pools (protected by `authenticate` and `requireRole`) */
export const list = async (req, res) => {
  // `req.user.id` is the only input. There is no body, query or params to
  // forward, so the `driverId` the service filters on cannot be supplied here.
  const pools = await listPools(req.user.id);

  return sendSuccess(res, { pools }, 200, 'Pools retrieved successfully');
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

/** PATCH /api/pools/:poolId/start (protected by `authenticate` and `requireRole`) */
export const start = async (req, res) => {
  // `req.body` is not forwarded, mirroring `create`: the new status and the
  // start timestamp are both decided in the service, so a client-supplied
  // `status` or `startedAt` has no path to the write.
  const pool = await startPool(req.user.id, req.params.poolId);

  return sendSuccess(res, { pool }, 200, 'Pool started successfully');
};

/** PATCH /api/pools/:poolId/complete (protected by `authenticate` and `requireRole`) */
export const complete = async (req, res) => {
  // `req.body` is not forwarded here either, which is what keeps
  // `finalFarePaisa` server-derived from `PoolMember.farePaisa`.
  const pool = await completePool(req.user.id, req.params.poolId);

  return sendSuccess(res, { pool }, 200, 'Pool completed successfully');
};
