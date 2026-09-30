import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const app = createApp();

const driverAccount = {
  name: 'Rafiq Islam',
  email: 'rafiq@example.com',
  password: 'password123',
  role: 'DRIVER',
};

const vehicle = {
  plateNumber: 'DHK-1234',
  model: 'Model 3',
  seatCapacity: 4,
};

/**
 * A departure window the API accepts. Derived from the clock rather than
 * hard-coded, because `departureFrom` must not be in the past and a literal
 * would start failing the day it went by.
 */
const futureWindow = (hoursFromNow = 24) => {
  const departureFrom = new Date(Date.now() + hoursFromNow * 3_600_000);

  return {
    departureFrom: departureFrom.toISOString(),
    departureTo: new Date(departureFrom.getTime() + 3_600_000).toISOString(),
  };
};

const rideRequestPayload = {
  pickupArea: 'Dhanmondi',
  destinationArea: 'Gulshan',
  seatsRequested: 1,
  ...futureWindow(),
};

const register = (payload) => request(app).post('/api/auth/register').send(payload);

/** Registers an account and returns the token plus the user id. */
const authenticate = async (overrides = {}) => {
  const { body } = await register({ ...driverAccount, ...overrides });
  return { token: body.data.token, userId: body.data.user.id };
};

const onboard = (token, payload = vehicle) =>
  request(app).post('/api/driver-profile').set('Authorization', `Bearer ${token}`).send(payload);

/**
 * Returns a fully onboarded driver: a token, their `userId`, their
 * `DriverProfile` id and their `Tesla` id. Pass `payload` to onboard a second
 * driver on a different plate, since the default one is already taken.
 */
const onboardedDriver = async (overrides = {}, payload = vehicle) => {
  const { token, userId } = await authenticate(overrides);
  const { body: onboarded } = await onboard(token, payload);

  return {
    token,
    userId,
    driverProfileId: onboarded.data.driverProfile.id,
    teslaId: onboarded.data.driverProfile.tesla.id,
  };
};

/** Registers a passenger and posts a ride request as a real client would. */
const passengerWithRideRequest = async (overrides = {}) => {
  const { token, userId } = await authenticate({
    name: 'Nusrat Jahan',
    email: 'nusrat@example.com',
    role: 'PASSENGER',
    ...overrides,
  });

  const { body } = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${token}`)
    .send(rideRequestPayload);

  return { token, userId, rideRequest: body.data.rideRequest };
};

const createPool = (token) =>
  request(app).post('/api/pools').set('Authorization', `Bearer ${token}`);

const addMember = (token, poolId, rideRequestId) =>
  request(app)
    .post(`/api/pools/${poolId}/members`)
    .set('Authorization', `Bearer ${token}`)
    .send({ rideRequestId });

const startPool = (token, poolId) =>
  request(app).patch(`/api/pools/${poolId}/start`).set('Authorization', `Bearer ${token}`);

const completePool = (token, poolId) =>
  request(app).patch(`/api/pools/${poolId}/complete`).set('Authorization', `Bearer ${token}`);

const rate = (token, payload) =>
  request(app).post('/api/ratings').set('Authorization', `Bearer ${token}`).send(payload);

/**
 * Builds a completed pool carrying `passengerCount` ride requests, driving the
 * whole lifecycle through the public endpoints, and returns the driver and the
 * passengers who were in it.
 *
 * Each call takes a fresh driver email and Tesla plate. The table set is only
 * truncated between tests, not between helpers within one, so a test that builds
 * two pools would otherwise collide on both unique columns.
 */
let poolsBuilt = 0;

const completedPool = async (passengerCount = 1) => {
  poolsBuilt += 1;
  const batch = poolsBuilt;

  const driver = await onboardedDriver(
    { name: `Driver ${batch}`, email: `driver${batch}@example.com` },
    { ...vehicle, plateNumber: `DHK-${String(1000 + batch)}` },
  );

  const { body: created } = await createPool(driver.token);
  const poolId = created.data.pool.id;
  const passengers = [];

  for (let index = 0; index < passengerCount; index += 1) {
    const participant = await passengerWithRideRequest({
      name: `Passenger ${batch}-${index}`,
      email: `passenger${batch}-${index}@example.com`,
    });

    await addMember(driver.token, poolId, participant.rideRequest.id);
    passengers.push(participant);
  }

  await startPool(driver.token, poolId);
  await completePool(driver.token, poolId);

  return { ...driver, poolId, passengers };
};

/**
 * Stages the one account that is both the pool's driver and its only passenger.
 *
 * The API cannot produce this: `POST /api/ride-requests` is guarded by
 * `requireRole('PASSENGER')` and `POST /api/driver-profile` by
 * `requireRole('DRIVER')`, so no account can pick up both sides through the HTTP
 * layer. The database does not stop it either, because `DriverProfile.userId` and
 * `RideRequest.passengerId` are both plain foreign keys onto `users.id` with no
 * role constraint. Staging it directly is therefore the only way to reach the
 * defensive self-rating branch, which no real client can reach.
 */
const selfRatingPool = async () => {
  const { token, userId, rideRequest } = await passengerWithRideRequest();

  const driverProfile = await prisma.driverProfile.create({
    data: {
      userId,
      tesla: { create: { plateNumber: 'DHK-7777', model: 'Model 3', seatCapacity: 4 } },
    },
  });

  const tesla = await prisma.tesla.findUnique({ where: { driverId: driverProfile.id } });

  const pool = await prisma.pool.create({
    data: {
      driverId: driverProfile.id,
      vehicleId: tesla.id,
      status: 'COMPLETED',
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  await prisma.poolMember.create({
    data: { poolId: pool.id, rideRequestId: rideRequest.id, seats: 1, farePaisa: 10_000 },
  });

  await prisma.rideRequest.update({
    where: { id: rideRequest.id },
    data: { status: 'COMPLETED' },
  });

  return { token, userId, poolId: pool.id };
};

describe('POST /api/ratings', () => {
  it('lets a passenger rate the driver of a completed pool', async () => {
    const { poolId, passengers, userId: driverUserId } = await completedPool();

    const response = await rate(passengers[0].token, { poolId, score: 5 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Rating created successfully',
    });

    // The ratee is the driver's own user row, which is how a driver's score is
    // reachable without adding a separate DriverProfile column.
    expect(response.body.data.rating).toMatchObject({
      poolId,
      raterId: passengers[0].userId,
      rateeId: driverUserId,
      score: 5,
    });
    expect(response.body.data.rating.rateeId).not.toBe(passengers[0].userId);
  });

  it('lets the driver rate the single passenger of a completed pool', async () => {
    const { token, userId, poolId, passengers } = await completedPool();

    const response = await rate(token, { poolId, score: 4 });

    expect(response.status).toBe(201);
    expect(response.body.data.rating).toMatchObject({
      poolId,
      raterId: userId,
      rateeId: passengers[0].userId,
      score: 4,
    });
    expect(response.body.data.rating.rateeId).not.toBe(userId);
  });

  it('persists the score exactly as sent', async () => {
    // Each score needs its own pool, because one rater may only score a pool
    // once, so this builds three completed pools. They are built sequentially:
    // the suite shares one database, so two builds at once would collide on the
    // driver's email and Tesla plate.
    const pools = [await completedPool(), await completedPool(), await completedPool()];
    const scores = [1, 3, 5];

    for (const [index, pool] of pools.entries()) {
      const response = await rate(pool.passengers[0].token, {
        poolId: pool.poolId,
        score: scores[index],
      });

      expect(response.status).toBe(201);
      expect(response.body.data.rating.score).toBe(scores[index]);

      const stored = await prisma.rating.findFirst({ where: { poolId: pool.poolId } });

      expect(stored.score).toBe(scores[index]);
      expect(Number.isInteger(stored.score)).toBe(true);
    }
  });

  it('returns only the safe rating DTO', async () => {
    const { token, poolId } = await completedPool();

    const response = await rate(token, { poolId, score: 3 });

    expect(response.status).toBe(201);
    expect(Object.keys(response.body.data.rating).sort()).toEqual([
      'createdAt',
      'id',
      'poolId',
      'rateeId',
      'raterId',
      'score',
      'updatedAt',
    ]);

    for (const relation of ['rater', 'ratee', 'pool', 'driverProfile']) {
      expect(response.body.data.rating).not.toHaveProperty(relation);
    }

    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(driverAccount.password);
  });
});

describe('POST /api/ratings pool rules', () => {
  it('returns 404 for a pool that does not exist', async () => {
    const { token } = await onboardedDriver();

    const response = await rate(token, {
      poolId: '1b3d6f2a-0000-4000-8000-000000000000',
      score: 5,
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Pool not found' });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('returns 409 for an OPEN pool', async () => {
    const { token } = await onboardedDriver();
    const { body: created } = await createPool(token);

    const response = await rate(token, { poolId: created.data.pool.id, score: 5 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, message: 'Pool is not completed' });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('returns 409 for an IN_PROGRESS pool', async () => {
    const { token } = await onboardedDriver();
    const { body: created } = await createPool(token);
    const { rideRequest } = await passengerWithRideRequest();

    await addMember(token, created.data.pool.id, rideRequest.id);
    await startPool(token, created.data.pool.id);

    const response = await rate(token, { poolId: created.data.pool.id, score: 5 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, message: 'Pool is not completed' });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('returns 409 for a COMPLETED pool that carries no passengers', async () => {
    const { token } = await onboardedDriver();
    const { body: created } = await createPool(token);

    await startPool(token, created.data.pool.id);
    await completePool(token, created.data.pool.id);

    const response = await rate(token, { poolId: created.data.pool.id, score: 5 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      message: 'This ride has no passengers to rate',
    });
    expect(await prisma.rating.count()).toBe(0);
  });
});

describe('POST /api/ratings participant rules', () => {
  it('rejects a passenger who was not in the pool with 403', async () => {
    const { poolId } = await completedPool();
    const outsider = await passengerWithRideRequest({
      name: 'Outsider',
      email: 'outsider@example.com',
    });

    const response = await rate(outsider.token, { poolId, score: 1 });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      message: 'You are not a participant of this ride',
    });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('rejects a driver who did not drive the pool with 403', async () => {
    const { poolId } = await completedPool();
    const otherDriver = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );

    const response = await rate(otherDriver.token, { poolId, score: 1 });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      message: 'You are not a participant of this ride',
    });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('refuses to let the driver rate a pool carrying several passengers', async () => {
    const { token, poolId, passengers } = await completedPool(2);

    expect(passengers).toHaveLength(2);

    const response = await rate(token, { poolId, score: 5 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      message: 'This ride has multiple passengers and cannot be rated by the driver',
    });
    expect(await prisma.rating.count()).toBe(0);

    // The passengers themselves are unaffected by the driver's restriction, so
    // the ride is not left unratable from every direction.
    expect((await rate(passengers[0].token, { poolId, score: 4 })).status).toBe(201);
  });

  it('rejects an account that is both the driver and the passenger with 403', async () => {
    const { token, poolId } = await selfRatingPool();

    const response = await rate(token, { poolId, score: 5 });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      message: 'You cannot rate yourself',
    });
    expect(await prisma.rating.count()).toBe(0);
  });
});

describe('POST /api/ratings duplicates', () => {
  it('returns 409 when the same rater scores the same pool twice', async () => {
    const { poolId, passengers } = await completedPool();

    expect((await rate(passengers[0].token, { poolId, score: 5 })).status).toBe(201);

    const second = await rate(passengers[0].token, { poolId, score: 1 });

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      success: false,
      message: 'You have already rated this ride',
    });
    expect(await prisma.rating.count()).toBe(1);

    // The rejected second attempt must not overwrite the score already stored.
    expect((await prisma.rating.findFirst({ where: { poolId } })).score).toBe(5);
  });

  it('lets the driver and the passenger each score the same pool', async () => {
    const { token, userId, poolId, passengers } = await completedPool();

    expect((await rate(passengers[0].token, { poolId, score: 5 })).status).toBe(201);
    expect((await rate(token, { poolId, score: 2 })).status).toBe(201);

    const ratings = await prisma.rating.findMany({ where: { poolId } });

    // The unique index is on `(poolId, raterId)`, not on `poolId` alone.
    expect(ratings).toHaveLength(2);
    expect(ratings.map((rating) => rating.raterId).sort()).toEqual(
      [userId, passengers[0].userId].sort(),
    );
  });

  it('enforces the constraint in the database, not only in the service', async () => {
    const { poolId, passengers, userId: driverUserId } = await completedPool();

    await rate(passengers[0].token, { poolId, score: 5 });

    await expect(
      prisma.rating.create({
        data: {
          poolId,
          raterId: passengers[0].userId,
          rateeId: driverUserId,
          score: 2,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(await prisma.rating.count()).toBe(1);
  });
});

describe('POST /api/ratings validation', () => {
  let token;
  let poolId;

  beforeEach(async () => {
    ({ token, poolId } = await completedPool());
  });

  it.each([
    ['zero', 0, 'Score must be at least 1'],
    ['six', 6, 'Score must be at most 5'],
    ['a negative number', -1, 'Score must be at least 1'],
    ['a fraction', 3.5, 'Score must be a whole number'],
  ])('rejects %s as a score', async (_label, score, message) => {
    const response = await rate(token, { poolId, score });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details.map((issue) => issue.message)).toContain(message);
    expect(await prisma.rating.count()).toBe(0);
  });

  it('rejects a numeric string as a score', async () => {
    const response = await rate(token, { poolId, score: '3' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details[0].field).toBe('score');
    expect(await prisma.rating.count()).toBe(0);
  });

  it('rejects a poolId that is not a UUID', async () => {
    const response = await rate(token, { poolId: 'not-a-uuid', score: 3 });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details.map((issue) => issue.field)).toContain('poolId');
    expect(await prisma.rating.count()).toBe(0);
  });

  it('rejects a missing poolId', async () => {
    const response = await rate(token, { score: 3 });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details.map((issue) => issue.field)).toContain('poolId');
    expect(await prisma.rating.count()).toBe(0);
  });

  it('rejects a missing score', async () => {
    const response = await rate(token, { poolId });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details.map((issue) => issue.field)).toContain('score');
    expect(await prisma.rating.count()).toBe(0);
  });
});

describe('POST /api/ratings security', () => {
  it('requires authentication', async () => {
    const response = await request(app).post('/api/ratings').send({ score: 3 });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(await prisma.rating.count()).toBe(0);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app)
      .post('/api/ratings')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ score: 3 });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(await prisma.rating.count()).toBe(0);
  });

  it('allows both a passenger and a driver to post', async () => {
    const passengerPool = await completedPool();

    expect((await rate(passengerPool.passengers[0].token, {
      poolId: passengerPool.poolId,
      score: 5,
    })).status).toBe(201);

    const driverPool = await completedPool();

    expect((await rate(driverPool.token, { poolId: driverPool.poolId, score: 4 })).status).toBe(201);
    expect(await prisma.rating.count()).toBe(2);
  });

  it('ignores a forged raterId and rateeId in the request body', async () => {
    const { poolId, passengers } = await completedPool();
    const attacker = await passengerWithRideRequest({
      name: 'Attacker',
      email: 'attacker@example.com',
    });

    const response = await rate(passengers[0].token, {
      poolId,
      score: 5,
      raterId: attacker.userId,
      rateeId: attacker.userId,
      userId: attacker.userId,
      driverId: attacker.userId,
      passengerId: attacker.userId,
      id: attacker.userId,
      status: 'COMPLETED',
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '1999-01-01T00:00:00.000Z',
    });

    expect(response.status).toBe(201);

    const stored = await prisma.rating.findFirst({ where: { poolId } });

    expect(stored.raterId).toBe(passengers[0].userId);
    expect(stored.rateeId).not.toBe(attacker.userId);
    expect(stored.rateeId).not.toBe(passengers[0].userId);
    expect(stored.score).toBe(5);
    expect(new Date(stored.createdAt).getUTCFullYear()).not.toBe(1999);
  });

  it('never stores a ratee that is not the other participant', async () => {
    const { token, userId, poolId, passengers } = await completedPool();
    const stranger = await passengerWithRideRequest({
      name: 'Stranger',
      email: 'stranger@example.com',
    });

    await rate(token, { poolId, score: 3 });

    const stored = await prisma.rating.findFirst({ where: { poolId } });

    expect(stored.rateeId).toBe(passengers[0].userId);
    expect(stored.rateeId).not.toBe(stranger.userId);
    expect(stored.rateeId).not.toBe(userId);
  });
});

describe('Rating cascades', () => {
  it("deletes a pool's ratings when the pool is deleted", async () => {
    const { poolId, passengers } = await completedPool();

    await rate(passengers[0].token, { poolId, score: 5 });
    expect(await prisma.rating.count()).toBe(1);

    await prisma.pool.delete({ where: { id: poolId } });

    expect(await prisma.rating.count()).toBe(0);
  });

  it('deletes the ratings a rater gave when that user is deleted', async () => {
    const { poolId, passengers } = await completedPool();

    await rate(passengers[0].token, { poolId, score: 5 });
    expect(await prisma.rating.count()).toBe(1);

    // The pool survives here, so only the `rater` cascade can remove the row.
    await prisma.user.delete({ where: { id: passengers[0].userId } });

    expect(await prisma.rating.count()).toBe(0);
  });

  it('deletes the ratings a ratee received when that user is deleted', async () => {
    const { token, poolId, passengers } = await completedPool();

    await rate(token, { poolId, score: 5 });

    const stored = await prisma.rating.findFirst({ where: { poolId } });

    expect(stored.rateeId).toBe(passengers[0].userId);
    expect(await prisma.rating.count()).toBe(1);

    // Again the pool stays, so only the `ratee` cascade can remove the row.
    await prisma.user.delete({ where: { id: passengers[0].userId } });

    expect(await prisma.rating.count()).toBe(0);
  });
});