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
