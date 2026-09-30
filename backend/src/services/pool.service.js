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

/**
 * Lists one driver's pools, newest first.
 *
 * Scoped to the authenticated driver only: `driverId` comes from the
 * `DriverProfile` looked up by the user id in the access token, never from the
 * request. This endpoint reads no body, no query string and no path parameter,
 * so that guarantee is structural rather than a matter of ignoring what was
 * sent: there is no channel through which a client could name a `driverId`.
 *
 * The `driverId, status` index on `pools` serves this filter. The
 * `createdAt: 'desc'` ordering is not a suffix of that index, so Postgres
 * filters through the index and sorts what is left, which is plenty at MVP
 * volume.
 *
 * Onboarding is treated as a prerequisite, exactly as in `createPool`: a driver
 * without a `DriverProfile` has no `driverId` to filter on and gets the same
 * 404. Returning an empty array instead would be indistinguishable from an
 * onboarded driver who has not opened a pool yet. That onboarded-but-no-pools
 * case is a normal outcome and returns an empty array.
 */
export const listPools = async (userId) => {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  const pools = await prisma.pool.findMany({
    where: { driverId: driverProfile.id },
    orderBy: { createdAt: 'desc' },
  });

  return pools.map(toPool);
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

/**
 * Resolves the caller's `DriverProfile` and their own `Pool`, for the lifecycle
 * endpoints.
 *
 * Ownership is answered with the same 404 as a missing pool, on purpose. A 403
 * would confirm that the pool id exists, which hands one driver an oracle for
 * discovering other drivers' pool ids. This is the same reasoning that governs
 * `addPoolMember` above and `getRideRequestById` in `rideRequest.service.js`.
 *
 * Only the columns the two transitions need are selected. `driverId` and
 * `status` are the only ones read, so the projection cannot accidentally widen
 * into something the response would then have to hide.
 */
const findOwnPool = async (userId, poolId) => {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    select: { id: true, driverId: true, status: true },
  });

  if (!pool) {
    throw AppError.notFound('Pool not found');
  }

  if (pool.driverId !== driverProfile.id) {
    throw AppError.notFound('Pool not found');
  }

  return pool;
};

/**
 * Takes a row lock on the driver's `driver_profiles` record for the rest of the
 * current transaction, so concurrent lifecycle writes by *the same driver* run
 * one after the other instead of interleaving.
 *
 * The one-active-ride rule below cannot be written as a conditional `UPDATE`
 * the way the `OPEN -> IN_PROGRESS` transition is, because it spans a computed
 * "does this driver have any other ride on the road" predicate rather than a
 * value of the row being updated. Prisma cannot express that as a constraint
 * either, which is why the specification puts it in the service layer.
 *
 * Without a lock, two `startPool` calls on two different pools of one driver
 * would both read "no active ride" and both commit, leaving exactly the state
 * this rule exists to prevent. Locking the one row that every such write must
 * touch closes that window: the second transaction blocks on the lock and, under
 * PostgreSQL's default READ COMMITTED isolation, then reads the first one's
 * committed `IN_PROGRESS` row.
 *
 * The lock is on the driver and not on the pool, because the contended resource
 * is the driver's single ride slot, not any individual pool row. It is also the
 * narrower choice for concurrency: two different drivers never block each other,
 * since each locks a row of their own.
 */
const lockDriverForActiveRide = async (tx, driverProfileId) => {
  await tx.$queryRaw`SELECT id FROM driver_profiles WHERE id = ${driverProfileId} FOR UPDATE`;
};

/**
 * Throws if `driverId` already has a ride on the road other than the pool being
 * started: the "a driver has one active ride at a time" rule from
 * `docs/architecture.md` (key relationships), which the document notes Prisma
 * cannot express as a constraint.
 *
 * "Active" means `IN_PROGRESS` and nothing else:
 *
 *   - An `OPEN` pool is an offer, not a ride. Nobody has been picked up yet, and
 *     nothing in the specification forbids a driver from staging several pools
 *     and choosing between them, so this deliberately does not block opening or
 *     starting a second pool while the first is still `OPEN`.
 *   - A `COMPLETED` or `CANCELLED` pool is history and never blocks anything.
 *
 * The pool being started is excluded from the count. It is `OPEN` at this point,
 * so it cannot match anyway, but excluding it states the rule as written -- a
 * driver's ride in progress is the one being started *now* -- and keeps the
 * check correct if it is ever reused from a different transition.
 *
 * Callers must already hold the driver lock from `lockDriverForActiveRide`, or
 * this read can race a concurrent start and miss the row it is looking for.
 */
const assertNoOtherActiveRide = async (tx, driverId, startingPoolId) => {
  const activeRide = await tx.pool.findFirst({
    where: {
      driverId,
      status: 'IN_PROGRESS',
      id: { not: startingPoolId },
    },
    select: { id: true },
  });

  if (activeRide) {
    throw AppError.conflict('Driver already has an active ride');
  }
};

/**
 * Starts a pool: `OPEN -> IN_PROGRESS`, and every matched ride request in it
 * `MATCHED -> IN_PROGRESS`.
 *
 * The pool and its members are moved together or not at all. A pool on the road
 * whose passengers still read `MATCHED`, or a passenger marked `IN_PROGRESS`
 * against a pool that never left, are both states the lifecycle must never
 * leave behind, so both writes share one transaction.
 *
 * The transition itself is a conditional `updateMany` on `status: 'OPEN'`, not
 * a blind write after the read above. It compiles to a single
 * `UPDATE ... WHERE id = ? AND status = 'OPEN'`, so PostgreSQL decides the
 * winner: two concurrent starts cannot both observe `OPEN` and both proceed.
 * `count === 0` is therefore the conflict signal, and because `startedAt` is
 * only ever written by that winning statement, a losing racer cannot stamp a
 * second start time onto the row.
 *
 * Starting an empty pool is allowed: an `OPEN` pool with no members is a state
 * the API can legitimately produce, and there is no rule in the schema or the
 * specification that forbids it.
 *
 * The member cascade is one bulk statement because every member takes the same
 * new value. It is deliberately scoped to `status: 'MATCHED'`, so a member in
 * any other state is left untouched rather than being dragged forward by a
 * transition it did not take part in. The API cannot produce that state: the
 * matching step is the only writer of `PoolMember`, and it always leaves the
 * request `MATCHED`.
 *
 * Starting a pool is also the point at which the specification's "a driver has
 * one active ride at a time" rule applies, so the transition is refused with a
 * 409 when the driver already has a ride in progress. That check runs inside this
 * transaction, behind the driver row lock, rather than as a pre-flight read next
 * to the `OPEN` check above: it is the only way the check and the transition see
 * the same picture when two starts race each other. Locking before reading means
 * a losing racer blocks until the winner has committed, and then reads the
 * `IN_PROGRESS` row that the winner wrote.
 *
 * Both guards raise before any write, so a refused start leaves this pool `OPEN`,
 * every member `MATCHED`, and the driver's existing ride untouched.
 */
export const startPool = async (userId, poolId) => {
  const pool = await findOwnPool(userId, poolId);

  if (pool.status !== 'OPEN') {
    throw AppError.conflict('Pool is not open');
  }

  const startedAt = new Date();

  const started = await prisma.$transaction(async (tx) => {
    await lockDriverForActiveRide(tx, pool.driverId);
    await assertNoOtherActiveRide(tx, pool.driverId, pool.id);

    const { count } = await tx.pool.updateMany({
      where: {
        id: pool.id,
        status: 'OPEN',
      },
      data: {
        status: 'IN_PROGRESS',
        startedAt,
      },
    });

    if (count === 0) {
      throw AppError.conflict('Pool is not open');
    }

    await tx.rideRequest.updateMany({
      where: {
        status: 'MATCHED',
        poolMemberships: { some: { poolId: pool.id } },
      },
      data: {
        status: 'IN_PROGRESS',
      },
    });

    // Re-read through the transaction client so the response reflects the row
    // this transaction just wrote, rather than the pre-flight read above.
    return tx.pool.findUnique({ where: { id: pool.id } });
  });

  return toPool(started);
};

/**
 * Completes a pool: `IN_PROGRESS -> COMPLETED`, and every ride request in it
 * `IN_PROGRESS -> COMPLETED` with its fare settled.
 *
 * `startedAt` is not part of the `data` below, so it keeps the value written by
 * `startPool` and a client cannot move it.
 *
 * Unlike the start, the member loop cannot be a single bulk statement: every
 * member settles at a different amount, because `PoolMember.farePaisa` is that
 * passenger's own agreed fare and two people sharing one Tesla do not pay the
 * same. `finalFarePaisa` is therefore always derived from the membership row,
 * never from the request body, which is the only money value that ever reaches
 * the write.
 *
 * Each member's update is conditional on `IN_PROGRESS`, and a member that does
 * not move fails the whole transaction. A pool that reported `COMPLETED` while
 * one of its passengers was still on an earlier status would be a lie the
 * dashboard would repeat, so the transition is refused instead. The pool update
 * is rolled back with it.
 */
export const completePool = async (userId, poolId) => {
  const pool = await findOwnPool(userId, poolId);

  if (pool.status !== 'IN_PROGRESS') {
    throw AppError.conflict('Pool is not in progress');
  }

  const completedAt = new Date();

  const completed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.pool.updateMany({
      where: {
        id: pool.id,
        status: 'IN_PROGRESS',
      },
      data: {
        status: 'COMPLETED',
        completedAt,
      },
    });

    if (count === 0) {
      throw AppError.conflict('Pool is not in progress');
    }

    const members = await tx.poolMember.findMany({
      where: { poolId: pool.id },
      select: { rideRequestId: true, farePaisa: true },
    });

    for (const member of members) {
      const { count: settled } = await tx.rideRequest.updateMany({
        where: {
          id: member.rideRequestId,
          status: 'IN_PROGRESS',
        },
        data: {
          status: 'COMPLETED',
          finalFarePaisa: member.farePaisa,
        },
      });

      if (settled === 0) {
        throw AppError.conflict('Ride request cannot be completed in its current status');
      }
    }

    return tx.pool.findUnique({ where: { id: pool.id } });
  });

  return toPool(completed);
};
