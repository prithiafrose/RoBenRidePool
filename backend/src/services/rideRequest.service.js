import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma.js';
import { toRideRequest } from './rideRequest.mapper.js';
import { AppError } from '../utils/AppError.js';

/**
 * MVP fare table. Every amount is in paisa (1 BDT = 100 paisa), matching the
 * schema comment. The numbers are deliberately round and readable because they
 * are placeholders, not a pricing model.
 */
const FARE = {
  /** Charged for any trip, before seats. */
  base: 5_000,
  /** Pickup and destination in the same area: a short hop. */
  sameArea: 3_000,
  /** Pickup and destination in different areas: a cross-city trip. */
  differentArea: 8_000,
  /** Added for each seat after the first. */
  perExtraSeat: 1_500,
};

/**
 * Deterministic estimate for a request.
 *
 * This is intentionally isolated in one exported-internal function so a real
 * fare table, distance matrix or route estimate can replace it without touching
 * `createRideRequest` or anything above it. It must stay deterministic: the
 * same request always yields the same estimate.
 */
const calculateEstimatedFarePaisa = ({ pickupArea, destinationArea, seatsRequested }) => {
  const sameArea = pickupArea.toLowerCase() === destinationArea.toLowerCase();
  const distanceComponent = sameArea ? FARE.sameArea : FARE.differentArea;

  return FARE.base + distanceComponent + (seatsRequested - 1) * FARE.perExtraSeat;
};

/**
 * The relation tree every *read* of a ride request selects.
 *
 * A read has to carry the matched pool because the MVP requires a passenger to be
 * able to see the pool they were accepted into; `createRideRequest` does not use
 * it, since a brand-new request is `WAITING` by definition. Sharing the include
 * here is what keeps a driver's view of a member's request and the passenger's own
 * view of it built from identical projections.
 */
const RIDE_REQUEST_INCLUDE = {
  poolMemberships: {
    include: {
      pool: {
        include: { driver: { include: { user: { select: { id: true, name: true } } } } },
      },
    },
    take: 1,
  },
};

/**
 * `RideRequestDecline` is unique on `(rideRequestId, driverId)`, so this is the
 * duplicate-decline code.
 */
const isUniqueViolation = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Creates a ride request for an authenticated passenger.
 *
 * `passengerId` comes from the verified access token, never from the body, and
 * `status` is left to the Prisma default so a new request is always WAITING.
 *
 * The departure window arrives as the validated ISO 8601 strings and is converted
 * to `Date` here, which is where a `Date` belongs: the validator's job is to
 * decide whether the value is well formed, not to reshape it. `new Date` applies
 * the offset the client stated and yields the UTC instant, so a `+06:00` value
 * and the equivalent `Z` value produce the same stored timestamp.
 *
 * Both conversions are written after the `...request` spread so they overwrite
 * whatever those keys held. That is the same reason `passengerId` and
 * `estimatedFarePaisa` are also assigned here rather than taken from the body:
 * every field the client must not control is assigned by the server after the
 * spread, so a stripped-but-present key cannot reach the insert.
 */
export const createRideRequest = async (passengerId, request) => {
  const passenger = await prisma.user.findUnique({ where: { id: passengerId } });

  if (!passenger) {
    throw AppError.unauthorized('Account no longer exists');
  }

  const estimatedFarePaisa = calculateEstimatedFarePaisa(request);

  const rideRequest = await prisma.rideRequest.create({
    data: {
      ...request,
      departureFrom: new Date(request.departureFrom),
      departureTo: new Date(request.departureTo),
      passengerId,
      estimatedFarePaisa,
    },
  });

  return toRideRequest(rideRequest);
};

/**
 * Lists one passenger's ride requests, newest first.
 *
 * Scoped to the authenticated passenger only: `passengerId` comes from the
 * access token, so a caller can never list somebody else's requests. The
 * `passengerId, createdAt` index on the table serves this filter and ordering.
 * An empty history is a normal outcome and returns an empty array.
 */
export const listRideRequests = async (passengerId) => {
  const rideRequests = await prisma.rideRequest.findMany({
    where: { passengerId },
    orderBy: { createdAt: 'desc' },
    include: RIDE_REQUEST_INCLUDE,
  });

  return rideRequests.map(toRideRequest);
};

/**
 * One passenger's request by id.
 *
 * The ownership check is part of the query predicate, not a comparison made
 * after the row is fetched: `findFirst` returns `null` both when the id does
 * not exist and when it belongs to somebody else, so a foreign id produces the
 * exact same `Ride request not found` 404 as a missing one. Returning 403
 * instead would confirm that the id exists and leak other passengers' ids.
 *
 * `passengerId` always comes from the verified access token. The `passenger`
 * relation is not selected, so `passwordHash` cannot reach the response.
 */
export const getRideRequestById = async (passengerId, id) => {
  const rideRequest = await prisma.rideRequest.findFirst({
    where: {
      id,
      passengerId,
    },
    include: RIDE_REQUEST_INCLUDE,
  });

  if (!rideRequest) {
    throw AppError.notFound('Ride request not found');
  }

  return toRideRequest(rideRequest);
};

/**
 * Cancels one of a passenger's own requests.
 *
 * The state guard lives in the query predicate rather than in a check made
 * after reading the row. `updateMany` compiles to a single
 * `UPDATE ... WHERE id = ? AND passengerId = ? AND status = 'WAITING'`, so
 * PostgreSQL decides the winner: a cancel racing a pool-match cannot overwrite
 * `MATCHED`, and two concurrent cancels cannot both report success. Reading
 * first and then writing would leave that window open.
 *
 * `count === 0` means the guard did not match, which has two causes that the
 * caller must not be able to tell apart without owning the row. The follow-up
 * lookup is ownership-scoped, so it returns `null` for both "does not exist"
 * and "belongs to somebody else", and both produce the identical 404 used by
 * `getRideRequestById`. Only a row this passenger owns can reach the 409.
 *
 * `passengerId` always comes from the verified access token. The `passenger`
 * relation is never selected, so `passwordHash` cannot reach the response.
 */
export const cancelRideRequest = async (passengerId, id) => {
  const { count } = await prisma.rideRequest.updateMany({
    where: {
      id,
      passengerId,
      status: 'WAITING',
    },
    data: {
      status: 'CANCELLED',
    },
  });

  if (count === 1) {
    return getRideRequestById(passengerId, id);
  }

  const ownRequest = await prisma.rideRequest.findFirst({
    where: {
      id,
      passengerId,
    },
  });

  if (!ownRequest) {
    throw AppError.notFound('Ride request not found');
  }

  throw AppError.conflict('Ride request cannot be cancelled in its current status');
};

/**
 * The queue of ride requests a driver may accept: everything still `WAITING`
 * that this driver has not already declined.
 *
 * This is the driver's counterpart to the passenger's own list, and it exists
 * because the MVP requires drivers to be able to *see* the requests they are
 * meant to accept or decline. Without it the only way into the matching step is
 * to already know a request id, which no client could obtain.
 *
 * Scoped by the authenticated driver rather than by anything in the request: the
 * `driverId` used in the `declines: { none: ... }` filter is the `DriverProfile`
 * resolved from the access token, so a client cannot widen the queue by naming
 * somebody else. Onboarding is a prerequisite for the same reason it is in
 * `pool.service.js`: without a `DriverProfile` there is no `driverId` to filter
 * declines by, and an onboarded driver with nothing to do is a normal outcome
 * that returns an empty array rather than a 404.
 *
 * `status: 'WAITING'` is the whole of the availability rule. A request leaves
 * this queue the moment it is accepted - `addPoolMember` claims it with a
 * conditional `UPDATE ... WHERE status = 'WAITING'` - so the filter needs no
 * extra "not already in a pool" test, and a request being matched by another
 * driver at this exact moment is handled by that claim rather than here.
 *
 * The driver's own `DriverStatus` (`ONLINE`/`OFFLINE`) is deliberately *not* a
 * filter. Nothing in the MVP requires an offline driver to be shown an empty
 * queue, and making availability gate visibility would be a rule nobody specified.
 * The status remains settable and readable on its own endpoint.
 *
 * Ordering is oldest first, which is the matching-queue order the
 * `(status, createdAt)` index on `ride_requests` exists to serve, and it is the
 * same order a passenger's requests were created in, so the earliest request is
 * the one a driver sees first.
 *
 * The passenger is projected to `{ id, name }`: a driver deciding whether to
 * share a car needs to know who they would be collecting, and `email`, `role` and
 * `passwordHash` are never selected, so they cannot reach the response.
 */
export const listAvailableRideRequests = async (userId) => {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  const rideRequests = await prisma.rideRequest.findMany({
    where: {
      status: 'WAITING',
      declines: { none: { driverId: driverProfile.id } },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      pickupArea: true,
      pickupLat: true,
      pickupLng: true,
      destinationArea: true,
      destinationLat: true,
      destinationLng: true,
      departureFrom: true,
      departureTo: true,
      seatsRequested: true,
      estimatedFarePaisa: true,
      status: true,
      createdAt: true,
      passenger: { select: { id: true, name: true } },
    },
  });

  return rideRequests.map((rideRequest) => ({
    ...toRideRequest(rideRequest),
    passenger: rideRequest.passenger,
  }));
};

/** Fields safe to return for a decline. No relations are selected at all. */
const toRideRequestDecline = (decline) => ({
  id: decline.id,
  rideRequestId: decline.rideRequestId,
  driverId: decline.driverId,
  createdAt: decline.createdAt,
});

/**
 * One driver declines one ride request.
 *
 * This is the half of "accept or decline" that the MVP spells out and that the
 * schema could not express as a status. A decline is recorded against the *pair*
 * of driver and request in `RideRequestDecline`, and the passenger's request is
 * never touched: it stays `WAITING`, keeps its fare and its window, and stays
 * acceptable by any other driver. There is deliberately no write to
 * `ride_requests` here at all - `status` is not read to be changed and no
 * `CANCELLED` is written - because cancelling on a decline would destroy the
 * passenger's ride over one driver's decision.
 *
 * `driverId` is the `DriverProfile` resolved from the verified access token, never
 * from the body, so a driver can only decline as themselves. Both foreign keys are
 * therefore server-derived or already-verified paths: the `rideRequestId` is a
 * path parameter the client is allowed to name, and everything else comes from the
 * token.
 *
 * The guards run cheapest-first, each before the ones after it can leak anything:
 *
 * 1. The driver must be onboarded, which is what produces the `driverId` the row
 *    needs. Un-onboarded drivers get the same 404 as elsewhere in the driver API.
 * 2. The request must exist.
 * 3. The request must still be `WAITING`. A request that has been accepted,
 *    completed or cancelled is no longer a driver decision, and declining it would
 *    record a fact about a ride that is already decided.
 *
 * Only a `WAITING` request can be declined, and every `WAITING` request is
 * something the driver was allowed to see in the first place, so there is no
 * separate "may this driver see this request" test to get wrong here.
 *
 * Duplication is handled by the database rather than by a read-then-write check:
 * `(rideRequestId, driverId)` is unique, so a second decline from the same driver
 * - whether a retry or a genuine race - hits `P2002` and becomes a 409. The raw
 * Prisma error is swallowed because `P2002` on its own is not something a client
 * can act on. Declining the same request from two *different* drivers is not a
 * duplicate at all: both rows are written and the request stays available to
 * everybody else, which is the behaviour the model exists to provide.
 */
export const declineRideRequest = async (userId, id) => {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  const rideRequest = await prisma.rideRequest.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!rideRequest) {
    throw AppError.notFound('Ride request not found');
  }

  if (rideRequest.status !== 'WAITING') {
    throw AppError.conflict('Ride request cannot be declined in its current status');
  }

  try {
    const decline = await prisma.$transaction(async (tx) => {
      /**
       * The status is re-read under a row lock rather than trusted from the read
       * above, because the accept path claims this same row with a conditional
       * `UPDATE` - which takes an exclusive lock on it. Taking the lock here
       * means a decline cannot land in the gap between that path's status check
       * and its write: the lock is granted only once the accepting transaction
       * has committed or rolled back, so the status read underneath it is the
       * committed one. Either the decline records against a still-waiting
       * request, or it is refused - never a decline against a taken ride.
       */
      const [current] = await tx.$queryRaw`
        SELECT id, status FROM ride_requests WHERE id = ${id} FOR UPDATE
      `;

      if (!current) {
        throw AppError.notFound('Ride request not found');
      }

      if (current.status !== 'WAITING') {
        throw AppError.conflict('Ride request cannot be declined in its current status');
      }

      return tx.rideRequestDecline.create({
        data: {
          rideRequestId: id,
          driverId: driverProfile.id,
        },
      });
    });

    return toRideRequestDecline(decline);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('Ride request already declined by this driver');
    }

    throw error;
  }
};
