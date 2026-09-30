import { z } from 'zod';

/**
 * Body of `POST /api/pools`, which is empty by design: everything the row
 * needs is derived server-side from the access token (see `pool.service.js`).
 * `driverId`, `vehicleId`, `status`, the ids and the timestamps are therefore
 * not just "not required" here, they are absent, so nothing the client sends
 * can be mistaken for them.
 *
 * An empty object schema with `.nullish()` is what makes a bodyless request
 * work: this project runs Express 5, where `req.body` stays `undefined` when
 * no body parser matched the request (no `Content-Type` at all), and a bare
 * `z.object({})` would reject that as a missing body. `.nullish()` accepts
 * every shape of "no body" — absent, `{}` and `null` — while still rejecting a
 * body that is not an object at all, such as a bare array.
 *
 * The schema stays non-strict on purpose, matching `auth.validator.js` and
 * `rideRequest.validator.js`: `validateBody` strips unknown keys, so a client
 * that sends `vehicleId` has it discarded rather than echoed. That is a
 * convenience, not the security control — `createPool` never receives
 * `req.body` at all, so a stripped key is also a key the service cannot read.
 */
export const createPoolSchema = z.object({}).nullish();

/**
 * Path parameter of `POST /api/pools/:poolId/members`.
 *
 * `poolId` is a Prisma `@default(uuid())` primary key, so a value that is not a
 * UUID can never match a row. Rejecting it here turns a client typo into a 400
 * with a field-level message, mirroring `rideRequestIdParamSchema` in
 * `rideRequest.validator.js`, instead of a 404 that is indistinguishable from a
 * pool that genuinely does not exist.
 */
export const poolIdParamSchema = z.object({
  poolId: z.uuid('Pool id must be a valid UUID'),
});

/**
 * Body of `POST /api/pools/:poolId/members`, which is exactly one field.
 *
 * `seats` and `farePaisa` are intentionally absent: both are derived from the
 * RideRequest by the service, so a client that sends them has them stripped and
 * the server values win. The schema stays non-strict on purpose, matching
 * `auth.validator.js`, `rideRequest.validator.js` and `createPoolSchema`:
 * `validateBody` discards unknown keys, and the controller then forwards only
 * `rideRequestId` to the service, so a stripped key is also a key the service
 * cannot read even if this middleware were dropped.
 */
export const addPoolMemberSchema = z.object({
  rideRequestId: z.uuid('Ride request id must be a valid UUID'),
});
