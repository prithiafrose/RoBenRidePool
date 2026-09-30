import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

/**
 * Fields safe to return. The `driver` and `vehicle` relations are deliberately
 * not selected, which keeps the whole `User` row — and with it `passwordHash` —
 * out of the response without having to enumerate what must be hidden. Nothing
 * on `Pool` itself is sensitive, so every scalar is safe to expose.
 */
const toPool = (pool) => ({
  id: pool.id,
  driverId: pool.driverId,
  vehicleId: pool.vehicleId,
  status: pool.status,
  startedAt: pool.startedAt,
  completedAt: pool.completedAt,
  createdAt: pool.createdAt,
  updatedAt: pool.updatedAt,
});

/**
 * Opens a new pool for the authenticated driver.
 *
 * Both foreign keys are resolved from the caller's own records rather than
 * taken from the request, so a driver can only ever open a pool for themselves
 * and with their own vehicle:
 *
 *   - `driverId` comes from the `DriverProfile` looked up by the authenticated
 *     user id, never from the body.
 *   - `vehicleId` comes from that profile's Tesla, which satisfies the
 *     "the Tesla must be the driver's own Tesla" rule the schema cannot
 *     express across the two tables (see the comment on `Pool.vehicleId`).
 *
 * `status` is left to the Prisma default of `OPEN`, and the timestamps are
 * left to the database, so a pool is never born started or completed.
 *
 * The request body is not an input to this function. That is the real reason a
 * client cannot forge a `driverId` or a `vehicleId`: the value never travels
 * from the HTTP layer into the insert.
 *
 * Onboarding is a prerequisite rather than something to work around: a driver
 * without a `DriverProfile`, or with a profile whose Tesla is missing, cannot
 * offer a ride, so each case gets a 404 naming exactly what is absent. Creating
 * the missing record here instead would let a client onboard itself as a side
 * effect of opening a pool.
 */
export const createPool = async (userId) => {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  const tesla = await prisma.tesla.findUnique({ where: { driverId: driverProfile.id } });

  if (!tesla) {
    throw AppError.notFound('Tesla not found');
  }

  const pool = await prisma.pool.create({
    data: { driverId: driverProfile.id, vehicleId: tesla.id },
  });

  return toPool(pool);
};

/** Fields safe to return for a membership. No relations are selected at all. */
const toPoolMember = (poolMember) => ({
  id: poolMember.id,
  poolId: poolMember.poolId,
  rideRequestId: poolMember.rideRequestId,
  seats: poolMember.seats,
  farePaisa: poolMember.farePaisa,
  createdAt: poolMember.createdAt,
  updatedAt: poolMember.updatedAt,
});

/** `PoolMember.rideRequestId` is unique, so this is the duplicate-membership code. */
const isUniqueViolation = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Adds a waiting ride request to one of the authenticated driver's own pools.
 *
 * This is the matching step: a passenger's `WAITING` RideRequest becomes a
 * `PoolMember` of an `OPEN` pool, and the request moves to `MATCHED`.
 *
 * Only three values reach this function: the authenticated `userId` and the two
 * ids the client is allowed to name. The request body is not an input, which is
 * the real reason a client cannot forge `seats` or `farePaisa` - those are read
 * off the RideRequest here and never travel from the HTTP layer into the insert.
 *
 * The guards run cheapest-first, and each one is checked before the ones after
 * it can leak anything:
 *
 * 1. The driver must be onboarded, so `driverId` is resolved from the verified
 *    token rather than the body.
 * 2. The pool must exist, belong to that driver, and be `OPEN`.
 * 3. The ride request must exist and be `WAITING`.
 * 4. The Tesla must have room.
 *
 * Ownership is answered with the same 404 as a missing pool on purpose. A 403
 * would confirm that the id exists, which hands one driver an oracle for
 * discovering other drivers' pool ids. The same reasoning already governs
 * `getRideRequestById` in `rideRequest.service.js`.
 *
 * Seat capacity counts the driver's own seat, because `Tesla.seatCapacity`
 * includes it, so the sum of the member allocations is compared against the
 * raw capacity with no `- 1` adjustment.
 */
export const addPoolMember = async (userId, poolId, rideRequestId) => {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  // The Tesla capacity and the seats already committed are needed for the
  // capacity check, so they are selected up front rather than in a second query.
  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    include: {
      vehicle: { select: { seatCapacity: true } },
      members: { select: { seats: true } },
    },
  });

  if (!pool) {
    throw AppError.notFound('Pool not found');
  }

  if (pool.driverId !== driverProfile.id) {
    throw AppError.notFound('Pool not found');
  }

  if (pool.status !== 'OPEN') {
    throw AppError.conflict('Pool is not open');
  }

  const rideRequest = await prisma.rideRequest.findUnique({ where: { id: rideRequestId } });

  if (!rideRequest) {
    throw AppError.notFound('Ride request not found');
  }

  if (rideRequest.status !== 'WAITING') {
    throw AppError.conflict('Ride request cannot be added to this pool in its current status');
  }

  const seatsAlreadyBooked = pool.members.reduce((total, member) => total + member.seats, 0);

  if (seatsAlreadyBooked + rideRequest.seatsRequested > pool.vehicle.seatCapacity) {
    throw AppError.conflict('Pool does not have enough available seats');
  }

  /**
   * Both writes share a transaction because neither is useful alone: a
   * PoolMember row pointing at a `WAITING` request, or a `MATCHED` request with
   * no pool behind it, are both states the matching step must never leave
   * behind. If either write fails, both are rolled back.
   *
   * Inside the transaction the two facts that can change under a concurrent
   * request are re-checked against the database rather than trusted from the
   * reads above:
   *
   * - The status transition is a conditional `updateMany` on
   *   `status: 'WAITING'`, not a blind write after a read. It compiles to one
   *   `UPDATE ... WHERE id = ? AND status = 'WAITING'`, so PostgreSQL decides
   *   the winner: two drivers matching the same request at the same time
   *   cannot both observe `WAITING` and both proceed. This is deliberately the
   *   first statement in the transaction, so the request is claimed before any
   *   row is inserted.
   * - The occupied seats are re-aggregated with the transaction client rather
   *   than reused from the pre-flight read.
   */
  try {
    const poolMember = await prisma.$transaction(async (tx) => {
      const { count } = await tx.rideRequest.updateMany({
        where: {
          id: rideRequestId,
          status: 'WAITING',
        },
        data: {
          status: 'MATCHED',
        },
      });

      if (count === 0) {
        throw AppError.conflict(
          'Ride request cannot be added to this pool in its current status',
        );
      }

      const occupied = await tx.poolMember.aggregate({
        where: { poolId: pool.id },
        _sum: { seats: true },
      });

      if ((occupied._sum.seats ?? 0) + rideRequest.seatsRequested > pool.vehicle.seatCapacity) {
        throw AppError.conflict('Pool does not have enough available seats');
      }

      return tx.poolMember.create({
        data: {
          poolId: pool.id,
          rideRequestId: rideRequest.id,
          seats: rideRequest.seatsRequested,
          farePaisa: rideRequest.estimatedFarePaisa,
        },
      });
    });

    return toPoolMember(poolMember);
  } catch (error) {
    if (isUniqueViolation(error)) {
      /**
       * `PoolMember.rideRequestId` is unique, so a request that is already in
       * some pool cannot be added to a second one. Reaching this branch means
       * the pre-flight `WAITING` check lost a race with another driver, so the
       * transaction has already rolled back the status write. The raw Prisma
       * error is swallowed here and replaced with a 409, because
       * `P2002` on its own is not something a client can act on.
       */
      throw AppError.conflict('Ride request is already in a pool');
    }

    throw error;
  }
};
