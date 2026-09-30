import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

/**
 * Fields safe to return. No relation is selected, so neither a `User` row - and
 * with it `passwordHash` - nor a `DriverProfile` or `Pool` can reach the client.
 * The four ids are the whole point of the response, so they are kept.
 */
const toRating = (rating) => ({
  id: rating.id,
  poolId: rating.poolId,
  raterId: rating.raterId,
  rateeId: rating.rateeId,
  score: rating.score,
  createdAt: rating.createdAt,
  updatedAt: rating.updatedAt,
});

/** `Rating` is unique on `(poolId, raterId)`, so this is the duplicate-rating code. */
const isUniqueViolation = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Records the score one participant gives the other after a completed pool.
 *
 * Only three values reach this function: the authenticated `userId` and the two
 * values the client is allowed to name. `raterId` and `rateeId` are both derived
 * here and never travel from the HTTP layer into the insert, which is the real
 * reason a client cannot forge either one - not a check that could be bypassed
 * by naming them anyway.
 *
 * The guards run cheapest-first, and each is checked before the ones after it
 * can leak anything:
 *
 * 1. The pool must exist.
 * 2. The pool must be `COMPLETED`, since a score for a ride that has not
 *    finished is not meaningful.
 * 3. The caller must have been in the pool, as its driver or as one of its
 *    passengers.
 * 4. The ratee is then derived, and a driver can only rate a pool that carried
 *    exactly one passenger (see below).
 *
 * `raterId` is the caller and `rateeId` is the *other* participant, which is
 * always a different person: the pool's driver is a `DriverProfile.userId`,
 * while every member is a `RideRequest.passengerId`, and the database does not
 * let those be the same account. The self-rating branch below is therefore
 * defensive rather than reachable - see the note on it.
 */
export const createRating = async (userId, { poolId, score }) => {
  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    include: {
      driver: true,
      members: { include: { rideRequest: true } },
    },
  });

  if (!pool) {
    throw AppError.notFound('Pool not found');
  }

  if (pool.status !== 'COMPLETED') {
    throw AppError.conflict('Pool is not completed');
  }

  const isDriver = pool.driver.userId === userId;
  const membership = pool.members.find((member) => member.rideRequest.passengerId === userId);

  if (!isDriver && !membership) {
    throw AppError.forbidden('You are not a participant of this ride');
  }

  let rateeId;

  if (isDriver) {
    /**
     * A pool exists to be shared, so the driver of a real pooled ride has
     * several passengers and no single one of them is "the" ratee. The
     * `(poolId, raterId)` unique index caps the driver at a single score per
     * pool, so naming an arbitrary passenger here would invent a policy nobody
     * agreed to. Refusing is the honest answer, and it fails loudly rather than
     * silently attributing the ride's score to whoever happened to be first.
     *
     * A completed pool with no passengers at all is a separate case: there is
     * nobody to score, which is not the same complaint as too many.
     */
    if (pool.members.length === 0) {
      throw AppError.conflict('This ride has no passengers to rate');
    }

    if (pool.members.length > 1) {
      throw AppError.conflict('This ride has multiple passengers and cannot be rated by the driver');
    }

    rateeId = pool.members[0].rideRequest.passengerId;
  } else {
    rateeId = pool.driver.userId;
  }

  if (rateeId === userId) {
    throw AppError.forbidden('You cannot rate yourself');
  }

  try {
    const rating = await prisma.rating.create({
      data: { poolId, raterId: userId, rateeId, score },
    });

    return toRating(rating);
  } catch (error) {
    if (isUniqueViolation(error)) {
      /**
       * The `(poolId, raterId)` index is the only thing stopping a second score
       * for the same ride, so this is the check the database performs rather
       * than a pre-flight read that two concurrent requests could both pass. The
       * raw Prisma error is swallowed and replaced with a 409, because `P2002` on
       * its own is not something a client can act on.
       */
      throw AppError.conflict('You have already rated this ride');
    }

    throw error;
  }
};