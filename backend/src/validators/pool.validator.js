import { z } from 'zod';

import { departureInstant, departureWindow } from './departureWindow.validator.js';

/**
 * Body of the lifecycle endpoints, `PATCH /api/pools/:poolId/start` and
 * `PATCH /api/pools/:poolId/complete`.
 *
 * Empty by design: a status transition takes nothing from the client. `status`,
 * `startedAt`, `completedAt`, `finalFarePaisa`, `driverId` and `vehicleId` are all
 * decided server-side, so a client that sends them has them discarded by
 * `validateBody`, and the controller forwards no body at all - so even without
 * this middleware the service would have no value to be misled by.
 *
 * `.nullish()` is what makes a bodyless request work: this project runs Express 5,
 * where `req.body` stays `undefined` when no body parser matched the request (no
 * `Content-Type` at all), and a bare `z.object({})` would reject that as a
 * missing body. `.nullish()` accepts every shape of "no body" - absent, `{}` and
 * `null` - while still rejecting a body that is not an object at all, such as a
 * bare array.
 */
const emptyBody = z.object({}).nullish();

/**
 * Body of `POST /api/pools`, which is exactly the departure window the driver is
 * offering and nothing else.
 *
 * The window is the one thing that genuinely has to come from the client: a
 * driver knows when they intend to leave, and the server cannot invent it. It is
 * required rather than optional because the whole matching rule hangs off it -
 * `addPoolMember` accepts a ride request only when its window overlaps this one -
 * and a pool with no window would have to either accept every request or be
 * unmatchable. Requiring it keeps that decision explicit instead of defaulting
 * it silently.
 *
 * Both fields are validated by `departureWindow.validator.js`, the same module
 * the passenger's own window is validated by, so the two sides of a comparison
 * can never disagree about what a well-formed instant is. That matters in
 * particular for the explicit-offset rule: a naive timestamp here would put an
 * uninterpretable instant into the column the overlap check reads.
 *
 * `driverId`, `vehicleId`, `status` and the timestamps are still absent by
 * design: everything the row needs besides the window is derived server-side from
 * the access token (see `pool.service.js`), so a client that sends them has them
 * stripped and the server values win. The schema stays non-strict on purpose,
 * matching `auth.validator.js` and `rideRequest.validator.js`.
 */
export const createPoolSchema = z
  .object({
    departureFrom: departureInstant('departureFrom'),
    departureTo: departureInstant('departureTo'),
  })
  .superRefine(departureWindow);

export const poolLifecycleSchema = emptyBody;

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
