import { prisma } from '../config/prisma.js';
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
 * Fields safe to return. The `passenger` relation is deliberately not exposed,
 * which keeps `passwordHash` and the rest of the user record out of the
 * response without having to enumerate what must be hidden.
 */
const toRideRequest = (rideRequest) => ({
  id: rideRequest.id,
  passengerId: rideRequest.passengerId,
  pickupArea: rideRequest.pickupArea,
  pickupLat: rideRequest.pickupLat,
  pickupLng: rideRequest.pickupLng,
  destinationArea: rideRequest.destinationArea,
  destinationLat: rideRequest.destinationLat,
  destinationLng: rideRequest.destinationLng,
  seatsRequested: rideRequest.seatsRequested,
  estimatedFarePaisa: rideRequest.estimatedFarePaisa,
  finalFarePaisa: rideRequest.finalFarePaisa,
  status: rideRequest.status,
  createdAt: rideRequest.createdAt,
});

/**
 * Creates a ride request for an authenticated passenger.
 *
 * `passengerId` comes from the verified access token, never from the body, and
 * `status` is left to the Prisma default so a new request is always WAITING.
 */
export const createRideRequest = async (passengerId, request) => {
  const passenger = await prisma.user.findUnique({ where: { id: passengerId } });

  if (!passenger) {
    throw AppError.unauthorized('Account no longer exists');
  }

  const estimatedFarePaisa = calculateEstimatedFarePaisa(request);

  const rideRequest = await prisma.rideRequest.create({
    data: { ...request, passengerId, estimatedFarePaisa },
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
