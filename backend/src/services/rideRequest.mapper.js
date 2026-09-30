/**
 * The safe projections for a ride request, in their own module.
 *
 * Both roles need to see a ride request - the passenger who made it, and the
 * driver whose pool carries it - and the MVP requires both dashboards to agree on
 * its fields. Producing the object in two services is how those two views drift
 * apart on something like `finalFarePaisa` or `status`, so the projection is
 * defined once here and imported by `rideRequest.service.js` for the passenger's
 * endpoints and by `pool.service.js` for the driver's view of a pool member.
 *
 * Everything in this file is pure: no Prisma, no database, no request context. It
 * takes whatever shape a query produced and decides what may leave the service
 * layer, which is the whole point of having it.
 */

/**
 * The pool a request has been matched into, as seen from the request.
 *
 * Returns `null` while the request is still `WAITING`, which is the honest answer
 * rather than an omission: a passenger polling their request before anybody has
 * accepted it should see `pool: null`, not a missing key, so the dashboard can
 * branch on one field instead of guessing from its absence.
 *
 * `driver` is reduced to `{ id, name }`, where `id` is the driver's `User` id so
 * it lines up with the `raterId`/`rateeId` a passenger uses elsewhere. The
 * `DriverProfile` is never exposed, and the `User` behind it is selected as `id`
 * and `name` only, so `email`, `role` and `passwordHash` are never fetched.
 */
const toMatchedPool = (rideRequest) => {
  const membership = rideRequest.poolMemberships?.[0];

  if (!membership?.pool) {
    return null;
  }

  const { pool } = membership;

  return {
    id: pool.id,
    status: pool.status,
    departureFrom: pool.departureFrom,
    departureTo: pool.departureTo,
    startedAt: pool.startedAt,
    completedAt: pool.completedAt,
    driver: pool.driver?.user ? { id: pool.driver.user.id, name: pool.driver.user.name } : null,
  };
};

/**
 * Fields safe to return for a ride request.
 *
 * The `passenger` relation is deliberately not exposed here, which keeps
 * `passwordHash` and the rest of the user record out of the response without
 * having to enumerate what must be hidden. The two places that do need to name a
 * passenger - a driver's available-rides queue and a driver's view of a pool
 * member - add their own `{ id, name }` on top of this.
 *
 * `pool` is the matched pool summary when one exists and `null` otherwise; see
 * `toMatchedPool`. It is read defensively because not every read includes the
 * membership: `createRideRequest` inserts and has no membership to report yet, so
 * a query that did not ask for it must not produce `undefined` here.
 */
export const toRideRequest = (rideRequest) => ({
  id: rideRequest.id,
  passengerId: rideRequest.passengerId,
  pickupArea: rideRequest.pickupArea,
  pickupLat: rideRequest.pickupLat,
  pickupLng: rideRequest.pickupLng,
  destinationArea: rideRequest.destinationArea,
  destinationLat: rideRequest.destinationLat,
  destinationLng: rideRequest.destinationLng,
  departureFrom: rideRequest.departureFrom,
  departureTo: rideRequest.departureTo,
  seatsRequested: rideRequest.seatsRequested,
  estimatedFarePaisa: rideRequest.estimatedFarePaisa,
  finalFarePaisa: rideRequest.finalFarePaisa,
  status: rideRequest.status,
  pool: toMatchedPool(rideRequest),
  createdAt: rideRequest.createdAt,
});