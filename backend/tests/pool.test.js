import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import {
  addPoolMember as addPoolMemberForUser,
  completePool as completePoolForUser,
  createPool as createPoolForUser,
  startPool as startPoolForUser,
} from '../src/services/pool.service.js';

const app = createApp();

const driver = {
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

const register = (payload = driver) => request(app).post('/api/auth/register').send(payload);

/** Registers an account and returns the token plus the user id. */
const authenticate = async (overrides = {}) => {
  const { body } = await register({ ...driver, ...overrides });
  return { token: body.data.token, userId: body.data.user.id };
};

/** Registers a driver and runs the onboarding endpoint, as a real client would. */
const onboard = (token, payload = vehicle) =>
  request(app).post('/api/driver-profile').set('Authorization', `Bearer ${token}`).send(payload);

/**
 * Returns a fully onboarded driver: a token, their `DriverProfile` id and
 * their `Tesla` id, so a test can assert against real ids instead of
 * re-deriving them. Pass `payload` to onboard a second driver on a different
 * plate, since the default one is already taken.
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

const createPool = (token, payload) => {
  const req = request(app).post('/api/pools').set('Authorization', `Bearer ${token}`);

  // Omitting `.send()` leaves the request with no body and no Content-Type,
  // which is the normal way this endpoint is called.
  return payload === undefined ? req : req.send(payload);
};

const listPools = (token) => request(app).get('/api/pools').set('Authorization', `Bearer ${token}`);

const rideRequestPayload = {
  pickupArea: 'Dhanmondi',
  destinationArea: 'Gulshan',
  seatsRequested: 2,
};

/** Registers a passenger and posts a ride request as a real client would. */
const passengerWithRideRequest = async (overrides = {}, payload = rideRequestPayload) => {
  const { token } = await authenticate({
    name: 'Nusrat Jahan',
    email: 'nusrat@example.com',
    role: 'PASSENGER',
    ...overrides,
  });

  const { body } = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  return { token, rideRequest: body.data.rideRequest };
};

const addMember = (token, poolId, payload) =>
  request(app)
    .post(`/api/pools/${poolId}/members`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

/**
 * Builds a lifecycle request. Both transitions take an empty body, so omitting
 * `payload` leaves the request with no body and no Content-Type, which is the
 * normal way these endpoints are called.
 */
const lifecycle = (action) => (token, poolId, payload) => {
  const req = request(app).patch(`/api/pools/${poolId}/${action}`).set('Authorization', `Bearer ${token}`);

  return payload === undefined ? req : req.send(payload);
};

const startPool = lifecycle('start');
const completePool = lifecycle('complete');

/**
 * Onboards a second driver with their own Tesla and their own OPEN pool, for the
 * ownership tests. The default plate is already taken by the driver under test.
 */
const otherDriverWithPool = async () => {
  const other = await onboardedDriver(
    { name: 'Other Driver', email: 'other@example.com' },
    { ...vehicle, plateNumber: 'DHK-9999' },
  );
  const { id: otherPoolId } = (await createPool(other.token)).body.data.pool;

  return { ...other, otherPoolId };
};

/** Adds `count` distinct waiting ride requests to `token`'s own pool. */
const matchRideRequests = async (token, poolId, count) => {
  const members = [];

  for (let index = 0; index < count; index += 1) {
    const { rideRequest } = await passengerWithRideRequest(
      { email: `passenger${index}@example.com` },
      { ...rideRequestPayload, seatsRequested: 1 },
    );

    const { body } = await addMember(token, poolId, { rideRequestId: rideRequest.id });
    members.push({ rideRequest, poolMember: body.data.poolMember });
  }

  return members;
};

describe('POST /api/pools', () => {
  let token;
  let userId;
  let driverProfileId;
  let teslaId;

  beforeEach(async () => {
    ({ token, userId, driverProfileId, teslaId } = await onboardedDriver());
  });

  it('lets an onboarded driver create a pool', async () => {
    const response = await createPool(token);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Pool created successfully',
    });
    expect(response.body.data.pool).toMatchObject({
      driverId: driverProfileId,
      vehicleId: teslaId,
      status: 'OPEN',
    });
  });

  it('accepts a request with no body at all', async () => {
    const response = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(201);
    expect(response.body.data.pool).toMatchObject({ status: 'OPEN' });
  });

  it('persists the pool with the derived driver and vehicle', async () => {
    const { id } = (await createPool(token)).body.data.pool;

    const stored = await prisma.pool.findUnique({ where: { id } });
    expect(stored).not.toBeNull();
    expect(stored.driverId).toBe(driverProfileId);
    expect(stored.vehicleId).toBe(teslaId);
  });

  it('creates the pool as OPEN with no start or completion time', async () => {
    const { pool } = (await createPool(token)).body.data;

    expect(pool.status).toBe('OPEN');
    expect(pool.startedAt).toBeNull();
    expect(pool.completedAt).toBeNull();
  });

  it('returns DTO fields that match the persisted row', async () => {
    const { pool } = (await createPool(token)).body.data;
    const stored = await prisma.pool.findUnique({ where: { id: pool.id } });

    expect(pool).toMatchObject({
      id: stored.id,
      driverId: stored.driverId,
      vehicleId: stored.vehicleId,
      status: stored.status,
    });
  });

  it('returns exactly the documented DTO fields', async () => {
    const { pool } = (await createPool(token)).body.data;

    expect(Object.keys(pool).sort()).toEqual(
      ['id', 'driverId', 'vehicleId', 'status', 'startedAt', 'completedAt', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('never exposes the driver, the vehicle relation or a credential', async () => {
    const response = await createPool(token);
    const { pool } = response.body.data;

    expect(pool).not.toHaveProperty('driver');
    expect(pool).not.toHaveProperty('vehicle');
    expect(pool).not.toHaveProperty('members');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(driver.password);
  });

  it('ignores a client-supplied driverId and vehicleId', async () => {
    const other = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );

    const response = await createPool(token, {
      driverId: other.driverProfileId,
      vehicleId: other.teslaId,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.pool).toMatchObject({
      driverId: driverProfileId,
      vehicleId: teslaId,
    });

    const stored = await prisma.pool.findUnique({ where: { id: response.body.data.pool.id } });
    expect(stored.driverId).toBe(driverProfileId);
    expect(stored.vehicleId).toBe(teslaId);
    expect(stored.driverId).not.toBe(other.driverProfileId);
    expect(stored.vehicleId).not.toBe(other.teslaId);
  });

  it('ignores a client-supplied status', async () => {
    const response = await createPool(token, { status: 'COMPLETED' });

    expect(response.status).toBe(201);
    expect(response.body.data.pool.status).toBe('OPEN');

    const stored = await prisma.pool.findUnique({ where: { id: response.body.data.pool.id } });
    expect(stored.status).toBe('OPEN');
    expect(stored.completedAt).toBeNull();
  });

  it('ignores a body handed straight to the service, not just over HTTP', async () => {
    // The HTTP tests above are satisfied by `validateBody` stripping the keys
    // before the controller runs. This calls the service directly, so it pins
    // the second layer: the service must ignore an argument it should not even
    // be given. Without this, dropping `validateBody` from the route would
    // open a mass-assignment hole and the suite would still pass.
    const other = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );

    const pool = await createPoolForUser(userId, {
      driverId: other.driverProfileId,
      vehicleId: other.teslaId,
      status: 'COMPLETED',
    });

    expect(pool).toMatchObject({
      driverId: driverProfileId,
      vehicleId: teslaId,
      status: 'OPEN',
      startedAt: null,
      completedAt: null,
    });

    const stored = await prisma.pool.findUnique({ where: { id: pool.id } });
    expect(stored.driverId).toBe(driverProfileId);
    expect(stored.vehicleId).toBe(teslaId);
    expect(stored.driverId).not.toBe(other.driverProfileId);
    expect(stored.vehicleId).not.toBe(other.teslaId);
  });

  it('ignores client-supplied ids and timestamps', async () => {
    const response = await createPool(token, {
      id: 'a0000000-0000-4000-8000-000000000000',
      startedAt: '1999-01-01T00:00:00.000Z',
      completedAt: '1999-01-01T00:00:00.000Z',
      createdAt: '1999-01-01T00:00:00.000Z',
    });

    expect(response.status).toBe(201);
    const { pool } = response.body.data;

    expect(pool.id).not.toBe('a0000000-0000-4000-8000-000000000000');
    expect(pool.startedAt).toBeNull();
    expect(pool.completedAt).toBeNull();
    expect(new Date(pool.createdAt).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('rejects a passenger with 403', async () => {
    const passenger = await authenticate({
      name: 'Nusrat Jahan',
      email: 'nusrat@example.com',
      role: 'PASSENGER',
    });

    const response = await createPool(passenger.token);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
    expect(await prisma.pool.count()).toBe(0);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).post('/api/pools').send();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(await prisma.pool.count()).toBe(0);
  });

  it('rejects a garbage token with 401', async () => {
    const response = await request(app)
      .post('/api/pools')
      .set('Authorization', 'Bearer not.a.jwt')
      .send();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(await prisma.pool.count()).toBe(0);
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const fresh = await authenticate({ name: 'No Profile', email: 'noprofile@example.com' });

    const response = await createPool(fresh.token);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Driver profile not found' });
    expect(await prisma.pool.count()).toBe(0);
  });

  it('returns 404 for a driver profile with no Tesla', async () => {
    // The API always creates a profile and a Tesla together, so the missing
    // half can only be staged directly to exercise this branch.
    const { token: profileOnlyToken, userId } = await authenticate({
      name: 'No Tesla',
      email: 'notesla@example.com',
    });
    await prisma.driverProfile.create({ data: { userId } });

    const response = await createPool(profileOnlyToken);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Tesla not found' });
    expect(await prisma.pool.count()).toBe(0);
  });

  it('creates no PoolMember rows yet', async () => {
    await createPool(token);

    expect(await prisma.pool.count()).toBe(1);
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('leaves every RideRequest untouched', async () => {
    await createPool(token);

    expect(await prisma.rideRequest.count()).toBe(0);
  });

  it('opens a second pool for the same driver without touching the first', async () => {
    const first = (await createPool(token)).body.data.pool;
    const second = (await createPool(token)).body.data.pool;

    expect(first.id).not.toBe(second.id);
    expect(await prisma.pool.count()).toBe(2);

    const stored = await prisma.pool.findUnique({ where: { id: first.id } });
    expect(stored.status).toBe('OPEN');
  });
});

describe('GET /api/pools', () => {
  let token;
  let driverProfileId;
  let teslaId;

  beforeEach(async () => {
    ({ token, driverProfileId, teslaId } = await onboardedDriver());
  });

  /** Opens `count` pools for the driver under test, in creation order. */
  const createSeveralPools = async (count) => {
    const pools = [];

    for (let index = 0; index < count; index += 1) {
      const { body } = await createPool(token);
      pools.push(body.data.pool);
    }

    return pools;
  };

  it('returns an empty list for an onboarded driver with no pools', async () => {
    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Pools retrieved successfully',
    });
    expect(response.body.data.pools).toEqual([]);
  });

  it("returns the driver's own pools", async () => {
    const [created] = await createSeveralPools(1);

    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(1);
    expect(response.body.data.pools[0]).toMatchObject({
      id: created.id,
      driverId: driverProfileId,
      vehicleId: teslaId,
      status: 'OPEN',
      startedAt: null,
      completedAt: null,
    });
  });

  it("never returns another driver's pools", async () => {
    await createSeveralPools(2);
    const { token: otherToken, otherPoolId } = await otherDriverWithPool();

    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(2);

    for (const pool of response.body.data.pools) {
      expect(pool.driverId).toBe(driverProfileId);
    }

    expect(response.body.data.pools.map((pool) => pool.id)).not.toContain(otherPoolId);

    // The other driver really does have a pool, so the assertion above is not
    // passing just because this list happens to be empty or short.
    const otherList = await listPools(otherToken);
    expect(otherList.body.data.pools.map((pool) => pool.id)).toContain(otherPoolId);
  });

  it('lets a second driver see their own pool and nothing else', async () => {
    const [mine] = await createSeveralPools(1);
    const { token: otherToken, driverProfileId: otherProfileId, otherPoolId } =
      await otherDriverWithPool();

    const response = await listPools(otherToken);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(1);
    expect(response.body.data.pools[0]).toMatchObject({
      id: otherPoolId,
      driverId: otherProfileId,
    });
    expect(response.body.data.pools.map((pool) => pool.id)).not.toContain(mine.id);
  });

  it('returns the newest pool first', async () => {
    const created = await createSeveralPools(3);

    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(3);

    const timestamps = response.body.data.pools.map((pool) => new Date(pool.createdAt).getTime());

    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeLessThanOrEqual(timestamps[index - 1]);
    }

    // The last pool created is the newest, so it must come first.
    expect(response.body.data.pools[0].id).toBe(created.at(-1).id);
  });

  it('lists an OPEN pool with no lifecycle timestamps', async () => {
    const { id: poolId } = (await createPool(token)).body.data.pool;

    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(1);
    expect(response.body.data.pools[0]).toMatchObject({
      id: poolId,
      status: 'OPEN',
      startedAt: null,
      completedAt: null,
    });
  });

  it('lists an IN_PROGRESS pool with a start timestamp and no completion one', async () => {
    const { id: poolId } = (await createPool(token)).body.data.pool;
    await startPool(token, poolId);

    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(1);
    expect(response.body.data.pools[0]).toMatchObject({ id: poolId, status: 'IN_PROGRESS' });
    expect(response.body.data.pools[0].startedAt).not.toBeNull();
    expect(response.body.data.pools[0].completedAt).toBeNull();
  });

  it('lists a COMPLETED pool with both lifecycle timestamps', async () => {
    const { id: poolId } = (await createPool(token)).body.data.pool;
    await startPool(token, poolId);
    await completePool(token, poolId);

    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(1);
    expect(response.body.data.pools[0]).toMatchObject({ id: poolId, status: 'COMPLETED' });
    expect(response.body.data.pools[0].startedAt).not.toBeNull();
    expect(response.body.data.pools[0].completedAt).not.toBeNull();
  });

  it('never exposes the driver, the vehicle or the members of a pool', async () => {
    const { id: poolId } = (await createPool(token)).body.data.pool;
    await matchRideRequests(token, poolId, 1);

    // The pool really does have a driver, a vehicle and a member, so the
    // assertions below are not passing because the relations happen to be
    // empty. `passwordHash` lives on the driver through the `driver` relation.
    const stored = await prisma.pool.findUnique({
      where: { id: poolId },
      include: { driver: true, vehicle: true, members: true },
    });

    expect(stored.driver).not.toBeNull();
    expect(stored.vehicle).not.toBeNull();
    expect(stored.members).toHaveLength(1);

    const response = await listPools(token);

    expect(response.status).toBe(200);
    expect(response.body.data.pools).toHaveLength(1);

    const pool = response.body.data.pools[0];
    expect(pool).not.toHaveProperty('driver');
    expect(pool).not.toHaveProperty('vehicle');
    expect(pool).not.toHaveProperty('members');

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(driver.password);
    expect(serialized).not.toContain(vehicle.plateNumber);
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const { token: fresh } = await authenticate({ email: 'newdriver@example.com' });

    const response = await listPools(fresh);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Driver profile not found' });
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/pools');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(await prisma.pool.count()).toBe(0);
  });

  it('rejects a passenger', async () => {
    const { token: passengerToken } = await passengerWithRideRequest();

    const response = await listPools(passengerToken);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
    expect(await prisma.pool.count()).toBe(0);
  });
});

describe('POST /api/pools/:poolId/members', () => {
  let token;
  let userId;
  let teslaId;
  let poolId;
  let rideRequest;
  let storedMemberId;

  beforeEach(async () => {
    ({ token, userId, teslaId } = await onboardedDriver());
    ({ id: poolId } = (await createPool(token)).body.data.pool);
    ({ rideRequest } = await passengerWithRideRequest());
  });

  /** The single PoolMember row an accepted match is expected to leave behind. */
  const storedMember = () => prisma.poolMember.findUnique({ where: { id: storedMemberId } });

  it('lets a driver add a waiting ride request to their own open pool', async () => {
    const response = await addMember(token, poolId, { rideRequestId: rideRequest.id });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Ride request added to pool successfully',
    });
    expect(response.body.data.poolMember).toMatchObject({
      poolId,
      rideRequestId: rideRequest.id,
    });
  });

  it('persists a PoolMember pointing at the requested pool', async () => {
    const { body } = await addMember(token, poolId, { rideRequestId: rideRequest.id });
    storedMemberId = body.data.poolMember.id;

    const member = await storedMember();
    expect(member).not.toBeNull();
    expect(member.poolId).toBe(poolId);
  });

  it('persists a PoolMember pointing at the requested ride request', async () => {
    const { body } = await addMember(token, poolId, { rideRequestId: rideRequest.id });
    storedMemberId = body.data.poolMember.id;

    const member = await storedMember();
    expect(member.rideRequestId).toBe(rideRequest.id);
  });

  it('takes the seats from the ride request, not from the client', async () => {
    const { body } = await addMember(token, poolId, { rideRequestId: rideRequest.id });
    storedMemberId = body.data.poolMember.id;

    const member = await storedMember();
    expect(member.seats).toBe(rideRequest.seatsRequested);
    expect(member.seats).toBe(2);
  });

  it('takes the fare from the ride request estimate, not from the client', async () => {
    const { body } = await addMember(token, poolId, { rideRequestId: rideRequest.id });
    storedMemberId = body.data.poolMember.id;

    const member = await storedMember();
    expect(member.farePaisa).toBe(rideRequest.estimatedFarePaisa);
  });

  it('moves the ride request from WAITING to MATCHED', async () => {
    await addMember(token, poolId, { rideRequestId: rideRequest.id });

    const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
    expect(stored.status).toBe('MATCHED');
  });

  it('returns exactly the documented DTO fields', async () => {
    const { poolMember } = (await addMember(token, poolId, { rideRequestId: rideRequest.id })).body
      .data;

    expect(Object.keys(poolMember).sort()).toEqual(
      ['id', 'poolId', 'rideRequestId', 'seats', 'farePaisa', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('never exposes a relation or a credential', async () => {
    const response = await addMember(token, poolId, { rideRequestId: rideRequest.id });
    const { poolMember } = response.body.data;

    expect(poolMember).not.toHaveProperty('pool');
    expect(poolMember).not.toHaveProperty('rideRequest');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('password123');
  });

  it('rejects a passenger with 403', async () => {
    // A different email from the passenger that owns the ride request created in
    // the `beforeEach`, so this registers a second account instead of colliding.
    const passenger = await authenticate({
      name: 'Other Passenger',
      email: 'otherpassenger@example.com',
      role: 'PASSENGER',
    });

    const response = await addMember(passenger.token, poolId, { rideRequestId: rideRequest.id });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
    expect(await prisma.poolMember.count()).toBe(0);
    expect(
      (await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } })).status,
    ).toBe('WAITING');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post(`/api/pools/${poolId}/members`)
      .send({ rideRequestId: rideRequest.id });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('rejects a garbage token with 401', async () => {
    const response = await request(app)
      .post(`/api/pools/${poolId}/members`)
      .set('Authorization', 'Bearer not.a.jwt')
      .send({ rideRequestId: rideRequest.id });

    expect(response.status).toBe(401);
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('rejects a malformed pool id with a field-level 400', async () => {
    const response = await addMember(token, 'not-a-uuid', { rideRequestId: rideRequest.id });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toEqual([
      { field: 'poolId', message: 'Pool id must be a valid UUID' },
    ]);
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('rejects a malformed ride request id with a field-level 400', async () => {
    const response = await addMember(token, poolId, { rideRequestId: 'not-a-uuid' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toEqual([
      { field: 'rideRequestId', message: 'Ride request id must be a valid UUID' },
    ]);
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('rejects a missing ride request id with a field-level 400', async () => {
    const response = await addMember(token, poolId, {});

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([
      { field: 'rideRequestId', message: 'Ride request id must be a valid UUID' },
    ]);
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const fresh = await authenticate({ name: 'No Profile', email: 'noprofile@example.com' });

    const response = await addMember(fresh.token, poolId, { rideRequestId: rideRequest.id });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Driver profile not found' });
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('returns 404 for a pool that does not exist', async () => {
    const response = await addMember(token, randomUUID(), { rideRequestId: rideRequest.id });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Pool not found' });
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it("returns the same 404 for another driver's pool", async () => {
    // A 403 would confirm that the pool id exists, which hands a driver an
    // oracle for discovering other drivers' pool ids. The response must be
    // indistinguishable from the missing-pool case above.
    const other = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );
    const { id: otherPoolId } = (await createPool(other.token)).body.data.pool;

    const response = await addMember(token, otherPoolId, { rideRequestId: rideRequest.id });
    const missing = await addMember(token, randomUUID(), { rideRequestId: rideRequest.id });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Pool not found');
    expect(response.body.message).toBe(missing.body.message);
    expect(await prisma.poolMember.count()).toBe(0);
    expect(
      (await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } })).status,
    ).toBe('WAITING');
  });

  it('leaves another driver’s pool and its members untouched', async () => {
    const other = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );
    const { id: otherPoolId } = (await createPool(other.token)).body.data.pool;

    await addMember(token, otherPoolId, { rideRequestId: rideRequest.id });

    expect(await prisma.poolMember.count({ where: { poolId: otherPoolId } })).toBe(0);
    expect(await prisma.poolMember.count({ where: { poolId } })).toBe(0);
    expect(
      (await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } })).status,
    ).toBe('WAITING');
  });

  it('rejects a pool that is not OPEN with 409', async () => {
    await prisma.pool.update({ where: { id: poolId }, data: { status: 'IN_PROGRESS' } });

    const response = await addMember(token, poolId, { rideRequestId: rideRequest.id });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, message: 'Pool is not open' });
    expect(await prisma.poolMember.count()).toBe(0);
    expect(
      (await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } })).status,
    ).toBe('WAITING');
  });

  it.each(['COMPLETED', 'CANCELLED'])('rejects a %s pool with 409', async (status) => {
    await prisma.pool.update({ where: { id: poolId }, data: { status } });

    const response = await addMember(token, poolId, { rideRequestId: rideRequest.id });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Pool is not open');
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it('returns 404 for a ride request that does not exist', async () => {
    const response = await addMember(token, poolId, { rideRequestId: randomUUID() });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Ride request not found' });
    expect(await prisma.poolMember.count()).toBe(0);
  });

  it.each(['MATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])(
    'rejects a %s ride request with 409',
    async (status) => {
      await prisma.rideRequest.update({ where: { id: rideRequest.id }, data: { status } });

      const response = await addMember(token, poolId, { rideRequestId: rideRequest.id });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        success: false,
        message: 'Ride request cannot be added to this pool in its current status',
      });
      expect(await prisma.poolMember.count()).toBe(0);
      // The conflicting status must survive the rejected attempt.
      expect(
        (await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } })).status,
      ).toBe(status);
    },
  );

  it('rejects a ride request that does not fit in the Tesla with 409', async () => {
    // The Tesla seats 4 including the driver's own seat, and the pool is empty,
    // so a 4-seat request still fits but a 5-seat one cannot.
    const { rideRequest: oversized } = await passengerWithRideRequest(
      { email: 'nusrat2@example.com' },
      { ...rideRequestPayload, seatsRequested: 5 },
    );

    const response = await addMember(token, poolId, { rideRequestId: oversized.id });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Pool does not have enough available seats',
    });
    expect(await prisma.poolMember.count()).toBe(0);
    expect(
      (await prisma.rideRequest.findUnique({ where: { id: oversized.id } })).status,
    ).toBe('WAITING');
  });

  it('counts the seats already booked in the pool', async () => {
    // Fill the Tesla with a 3-seat request, then try to add a 2-seat one:
    // 3 + 2 > 4, so the second one has no room even though it would have fitted
    // into the empty pool.
    const { rideRequest: first } = await passengerWithRideRequest(
      { email: 'nusrat2@example.com' },
      { ...rideRequestPayload, seatsRequested: 3 },
    );
    expect((await addMember(token, poolId, { rideRequestId: first.id })).status).toBe(201);

    const { rideRequest: second } = await passengerWithRideRequest(
      { email: 'nusrat3@example.com' },
      { ...rideRequestPayload, seatsRequested: 2 },
    );
    const response = await addMember(token, poolId, { rideRequestId: second.id });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Pool does not have enough available seats');
    expect(await prisma.poolMember.count()).toBe(1);
  });

  it('accepts a request that exactly fills the remaining seats', async () => {
    const { rideRequest: first } = await passengerWithRideRequest(
      { email: 'nusrat2@example.com' },
      { ...rideRequestPayload, seatsRequested: 3 },
    );
    await addMember(token, poolId, { rideRequestId: first.id });

    const { rideRequest: second } = await passengerWithRideRequest(
      { email: 'nusrat3@example.com' },
      { ...rideRequestPayload, seatsRequested: 1 },
    );
    const response = await addMember(token, poolId, { rideRequestId: second.id });

    expect(response.status).toBe(201);
    expect(await prisma.poolMember.count()).toBe(2);

    const total = await prisma.poolMember.aggregate({
      where: { poolId },
      _sum: { seats: true },
    });
    expect(total._sum.seats).toBe(4);

    const tesla = await prisma.tesla.findUnique({ where: { id: teslaId } });
    expect(total._sum.seats).toBe(tesla.seatCapacity);
  });

  it('rejects the same ride request twice with 409', async () => {
    const first = await addMember(token, poolId, { rideRequestId: rideRequest.id });
    expect(first.status).toBe(201);

    const second = await addMember(token, poolId, { rideRequestId: rideRequest.id });

    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    // One membership, not two, and no raw Prisma error leaked to the client.
    expect(await prisma.poolMember.count()).toBe(1);
    expect(JSON.stringify(second.body)).not.toContain('P2002');
    expect(JSON.stringify(second.body)).not.toContain('Prisma');
  });

  it('rejects a ride request already matched into a different pool', async () => {
    // `PoolMember.rideRequestId` is unique, so a request can be in at most one
    // pool even though the status guard would already have caught the common
    // case. This stages the pre-check/race window directly.
    const other = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );
    const { id: otherPoolId } = (await createPool(other.token)).body.data.pool;

    await prisma.poolMember.create({
      data: {
        poolId: otherPoolId,
        rideRequestId: rideRequest.id,
        seats: rideRequest.seatsRequested,
        farePaisa: rideRequest.estimatedFarePaisa,
      },
    });

    const response = await addMember(token, poolId, { rideRequestId: rideRequest.id });

    expect(response.status).toBe(409);
    expect(await prisma.poolMember.count()).toBe(1);
  });

  it('rolls back the status change when the membership write fails', async () => {
    // A membership row is staged for this request while the request itself is
    // still WAITING. The transaction's first write (WAITING -> MATCHED) then
    // succeeds and its second write (the insert) fails on the unique index, so
    // this is a real proof of atomicity: the status change must not survive.
    await prisma.poolMember.create({
      data: {
        poolId,
        rideRequestId: rideRequest.id,
        seats: rideRequest.seatsRequested,
        farePaisa: rideRequest.estimatedFarePaisa,
      },
    });

    const response = await addMember(token, poolId, { rideRequestId: rideRequest.id });

    expect(response.status).toBe(409);
    // This message is the one the unique-violation handler produces. The
    // pre-flight status guard would have said something else, so seeing it here
    // proves the request got past the guards and the failure came from the
    // insert inside the transaction, not from the 400/404/409 checks before it.
    expect(response.body.message).toBe('Ride request is already in a pool');
    // The pre-existing row is the only one, and the request is still WAITING,
    // which can only happen if the status write was rolled back with it.
    expect(await prisma.poolMember.count()).toBe(1);
    expect(
      (await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } })).status,
    ).toBe('WAITING');
  });

  it('ignores a forged driverId, seats and farePaisa in the body', async () => {
    const other = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );

    const response = await addMember(token, poolId, {
      rideRequestId: rideRequest.id,
      driverId: other.driverProfileId,
      poolId: randomUUID(),
      rideRequestIdForged: randomUUID(),
      seats: 99,
      farePaisa: 1,
      status: 'COMPLETED',
      createdAt: '1999-01-01T00:00:00.000Z',
    });

    expect(response.status).toBe(201);
    const { poolMember } = response.body.data;

    expect(poolMember.poolId).toBe(poolId);
    expect(poolMember.seats).toBe(rideRequest.seatsRequested);
    expect(poolMember.farePaisa).toBe(rideRequest.estimatedFarePaisa);

    const stored = await prisma.poolMember.findUnique({ where: { id: poolMember.id } });
    expect(stored.poolId).toBe(poolId);
    expect(stored.driverId).toBeUndefined();
    expect(stored.seats).toBe(rideRequest.seatsRequested);
    expect(stored.farePaisa).toBe(rideRequest.estimatedFarePaisa);
    expect(new Date(stored.createdAt).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('ignores extra arguments handed straight to the service, not just over HTTP', async () => {
    // The HTTP test above is satisfied by `validateBody` stripping the keys
    // before the controller runs. This calls the service directly, so it pins
    // the second layer: `addPoolMember` takes three arguments and reads nothing
    // else, so dropping the middleware could not open a mass-assignment hole.
    const poolMember = await addPoolMemberForUser(
      userId,
      poolId,
      rideRequest.id,
      { driverId: userId, seats: 99, farePaisa: 1, status: 'COMPLETED' },
    );

    expect(poolMember).toMatchObject({
      poolId,
      rideRequestId: rideRequest.id,
      seats: rideRequest.seatsRequested,
      farePaisa: rideRequest.estimatedFarePaisa,
    });

    const stored = await prisma.poolMember.findUnique({ where: { id: poolMember.id } });
    expect(stored.seats).toBe(rideRequest.seatsRequested);
    expect(stored.farePaisa).toBe(rideRequest.estimatedFarePaisa);
  });

  it('cannot be used to move a ride request between two of the driver pools', async () => {
    const { id: secondPoolId } = (await createPool(token)).body.data.pool;
    const other = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );
    const { id: otherPoolId } = (await createPool(other.token)).body.data.pool;

    expect((await addMember(token, poolId, { rideRequestId: rideRequest.id })).status).toBe(201);
    expect(
      (await addMember(token, secondPoolId, { rideRequestId: rideRequest.id })).status,
    ).toBe(409);
    expect((await addMember(token, otherPoolId, { rideRequestId: rideRequest.id })).status).toBe(
      404,
    );

    expect(await prisma.poolMember.count()).toBe(1);
    expect((await prisma.poolMember.findFirst()).poolId).toBe(poolId);
  });
});

describe('PATCH /api/pools/:poolId/start', () => {
  let token;
  let userId;
  let poolId;

  beforeEach(async () => {
    ({ token, userId } = await onboardedDriver());
    ({ id: poolId } = (await createPool(token)).body.data.pool);
  });

  it('lets a driver start their own open pool', async () => {
    const response = await startPool(token, poolId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Pool started successfully',
    });
    expect(response.body.data.pool).toMatchObject({ id: poolId, status: 'IN_PROGRESS' });
  });

  it('persists the pool as IN_PROGRESS', async () => {
    const { id } = (await startPool(token, poolId)).body.data.pool;

    const stored = await prisma.pool.findUnique({ where: { id } });
    expect(stored.status).toBe('IN_PROGRESS');
  });

  it('stamps startedAt at the moment of the transition', async () => {
    const before = new Date();
    const { pool } = (await startPool(token, poolId)).body.data;
    const after = new Date();

    expect(pool.startedAt).not.toBeNull();
    const startedAt = new Date(pool.startedAt);
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('leaves completedAt null', async () => {
    const { pool } = (await startPool(token, poolId)).body.data;

    expect(pool.completedAt).toBeNull();
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).completedAt).toBeNull();
  });

  it('accepts a request with no body at all', async () => {
    const response = await request(app)
      .patch(`/api/pools/${poolId}/start`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.data.pool.status).toBe('IN_PROGRESS');
  });

  it('moves every matched ride request to IN_PROGRESS', async () => {
    const members = await matchRideRequests(token, poolId, 2);

    const response = await startPool(token, poolId);
    expect(response.status).toBe(200);

    for (const { rideRequest } of members) {
      const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
      expect(stored.status).toBe('IN_PROGRESS');
    }
  });

  it('starts a pool with no members', async () => {
    expect(await prisma.poolMember.count()).toBe(0);

    const response = await startPool(token, poolId);

    expect(response.status).toBe(200);
    expect(response.body.data.pool.status).toBe('IN_PROGRESS');
    expect(response.body.data.pool.startedAt).not.toBeNull();
  });

  it('leaves a ride request outside the pool untouched', async () => {
    // A second pool of the same driver's, with its own matched request, must not
    // be dragged along by this pool's transition.
    const { id: otherPoolId } = (await createPool(token)).body.data.pool;
    const [inside] = await matchRideRequests(token, poolId, 1);
    const { rideRequest: outside } = await passengerWithRideRequest(
      { email: 'outsider@example.com' },
      rideRequestPayload,
    );
    await addMember(token, otherPoolId, { rideRequestId: outside.id });

    expect((await startPool(token, poolId)).status).toBe(200);

    expect(
      (await prisma.rideRequest.findUnique({ where: { id: inside.rideRequest.id } })).status,
    ).toBe('IN_PROGRESS');
    expect(
      (await prisma.rideRequest.findUnique({ where: { id: outside.id } })).status,
    ).toBe('MATCHED');
  });

  it('returns exactly the documented DTO fields', async () => {
    const { pool } = (await startPool(token, poolId)).body.data;

    expect(Object.keys(pool).sort()).toEqual(
      ['id', 'driverId', 'vehicleId', 'status', 'startedAt', 'completedAt', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('never exposes the driver, the vehicle, the members or a credential', async () => {
    const response = await startPool(token, poolId);
    const { pool } = response.body.data;

    expect(pool).not.toHaveProperty('driver');
    expect(pool).not.toHaveProperty('vehicle');
    expect(pool).not.toHaveProperty('members');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(driver.password);
  });

  it('rejects a passenger with 403', async () => {
    const passenger = await authenticate({
      name: 'Other Passenger',
      email: 'otherpassenger@example.com',
      role: 'PASSENGER',
    });

    const response = await startPool(passenger.token, poolId);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('OPEN');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).patch(`/api/pools/${poolId}/start`).send();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('OPEN');
  });

  it('rejects a garbage token with 401', async () => {
    const response = await request(app)
      .patch(`/api/pools/${poolId}/start`)
      .set('Authorization', 'Bearer not.a.jwt')
      .send();

    expect(response.status).toBe(401);
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('OPEN');
  });

  it('rejects a malformed pool id with a field-level 400', async () => {
    const response = await startPool(token, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toEqual([
      { field: 'poolId', message: 'Pool id must be a valid UUID' },
    ]);
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('OPEN');
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const fresh = await authenticate({ name: 'No Profile', email: 'noprofile@example.com' });

    const response = await startPool(fresh.token, poolId);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Driver profile not found' });
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('OPEN');
  });

  it('returns 404 for a pool that does not exist', async () => {
    const response = await startPool(token, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Pool not found' });
  });

  it("returns the same 404 for another driver's pool", async () => {
    // A 403 would confirm that the pool id exists, which hands a driver an
    // oracle for discovering other drivers' pool ids. The response has to be
    // indistinguishable from the missing-pool case above.
    const { otherPoolId } = await otherDriverWithPool();

    const response = await startPool(token, otherPoolId);
    const missing = await startPool(token, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Pool not found');
    expect(response.body.message).toBe(missing.body.message);
    expect((await prisma.pool.findUnique({ where: { id: otherPoolId } })).status).toBe('OPEN');
  });

  it('rejects a pool that is already IN_PROGRESS with 409', async () => {
    await prisma.pool.update({ where: { id: poolId }, data: { status: 'IN_PROGRESS' } });

    const response = await startPool(token, poolId);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, message: 'Pool is not open' });
  });

  it.each(['COMPLETED', 'CANCELLED'])('rejects a %s pool with 409', async (status) => {
    await prisma.pool.update({ where: { id: poolId }, data: { status } });

    const response = await startPool(token, poolId);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Pool is not open');
  });

  it('cannot be started twice', async () => {
    expect((await startPool(token, poolId)).status).toBe(200);

    const first = await prisma.pool.findUnique({ where: { id: poolId } });
    const second = await startPool(token, poolId);

    expect(second.status).toBe(409);
    // The rejected start must not have restamped the row.
    const stored = await prisma.pool.findUnique({ where: { id: poolId } });
    expect(stored.startedAt.toISOString()).toBe(first.startedAt.toISOString());
  });

  it('lets only one of two concurrent starts succeed', async () => {
    const [first, second] = await Promise.all([startPool(token, poolId), startPool(token, poolId)]);

    // Whichever statement wins the row lock, the other must see a pool that is
    // no longer OPEN. A blind read-then-write would let both report 200.
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const stored = await prisma.pool.findUnique({ where: { id: poolId } });
    expect(stored.status).toBe('IN_PROGRESS');
    expect(stored.startedAt).not.toBeNull();
    expect(await prisma.pool.count({ where: { status: 'IN_PROGRESS' } })).toBe(1);
  });

  it('ignores a forged status, timestamps and driverId in the body', async () => {
    const { otherPoolId } = await otherDriverWithPool();

    const response = await startPool(token, poolId, {
      status: 'COMPLETED',
      startedAt: '1999-01-01T00:00:00.000Z',
      completedAt: '1999-01-01T00:00:00.000Z',
      createdAt: '1999-01-01T00:00:00.000Z',
      driverId: otherPoolId,
      vehicleId: randomUUID(),
    });

    expect(response.status).toBe(200);
    const { pool } = response.body.data;

    expect(pool.status).toBe('IN_PROGRESS');
    expect(pool.completedAt).toBeNull();
    expect(new Date(pool.startedAt).getUTCFullYear()).toBeGreaterThan(2020);

    const stored = await prisma.pool.findUnique({ where: { id: poolId } });
    expect(stored.status).toBe('IN_PROGRESS');
    expect(stored.completedAt).toBeNull();
    expect(stored.driverId).not.toBe(otherPoolId);
  });

  it('ignores extra arguments handed straight to the service, not just over HTTP', async () => {
    // The HTTP test above is satisfied by `validateBody` stripping the keys
    // before the controller runs. This calls the service directly, so it pins
    // the second layer: `startPool` takes two arguments and reads nothing else,
    // so dropping the middleware could not open a mass-assignment hole.
    const { otherPoolId } = await otherDriverWithPool();

    const pool = await startPoolForUser(userId, poolId, {
      status: 'COMPLETED',
      startedAt: '1999-01-01T00:00:00.000Z',
      completedAt: '1999-01-01T00:00:00.000Z',
      driverId: otherPoolId,
    });

    expect(pool).toMatchObject({ id: poolId, status: 'IN_PROGRESS', completedAt: null });
    expect(new Date(pool.startedAt).getUTCFullYear()).toBeGreaterThan(2020);

    const stored = await prisma.pool.findUnique({ where: { id: poolId } });
    expect(stored.status).toBe('IN_PROGRESS');
    expect(stored.completedAt).toBeNull();
  });

  describe('one active ride per driver', () => {
    /**
     * Puts the driver under test in the state the rule is about: one pool already
     * on the road, and `secondPoolId` staged as `OPEN` and ready to be started.
     */
    const driverWithRideInProgress = async () => {
      await startPool(token, poolId);
      const { id: secondPoolId } = (await createPool(token)).body.data.pool;

      return secondPoolId;
    };

    it('refuses to start a second pool while one is IN_PROGRESS', async () => {
      const secondPoolId = await driverWithRideInProgress();

      const response = await startPool(token, secondPoolId);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        success: false,
        message: 'Driver already has an active ride',
      });
      expect(response.body.data).toBeUndefined();
    });

    it('leaves the refused pool OPEN and the running ride untouched', async () => {
      const secondPoolId = await driverWithRideInProgress();
      const runningBefore = await prisma.pool.findUnique({ where: { id: poolId } });

      await startPool(token, secondPoolId);

      const refused = await prisma.pool.findUnique({ where: { id: secondPoolId } });
      expect(refused.status).toBe('OPEN');
      expect(refused.startedAt).toBeNull();

      const runningAfter = await prisma.pool.findUnique({ where: { id: poolId } });
      expect(runningAfter.status).toBe('IN_PROGRESS');
      expect(runningAfter.startedAt).toEqual(runningBefore.startedAt);
    });

    it('leaves matched members of the refused pool untouched', async () => {
      const { id: secondPoolId } = (await createPool(token)).body.data.pool;
      const [{ rideRequest, poolMember }] = await matchRideRequests(token, secondPoolId, 1);
      const memberBefore = await prisma.poolMember.findFirst({ where: { poolId: secondPoolId } });

      await startPool(token, poolId);
      await startPool(token, secondPoolId);

      const request = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
      expect(request.status).toBe('MATCHED');

      const memberAfter = await prisma.poolMember.findFirst({ where: { poolId: secondPoolId } });
      expect(memberAfter).toEqual(memberBefore);
      expect(memberAfter.seats).toBe(poolMember.seats);
      expect(memberAfter.farePaisa).toBe(poolMember.farePaisa);
    });

    it('lets the driver start a new ride once the previous one is COMPLETED', async () => {
      const secondPoolId = await driverWithRideInProgress();

      const completed = await completePool(token, poolId);
      expect(completed.status).toBe(200);

      const response = await startPool(token, secondPoolId);

      expect(response.status).toBe(200);
      expect(response.body.data.pool).toMatchObject({ id: secondPoolId, status: 'IN_PROGRESS' });
    });

    it('lets the driver start a new ride once the previous one is CANCELLED', async () => {
      const secondPoolId = await driverWithRideInProgress();
      await prisma.pool.update({ where: { id: poolId }, data: { status: 'CANCELLED' } });

      const response = await startPool(token, secondPoolId);

      expect(response.status).toBe(200);
      expect(response.body.data.pool).toMatchObject({ id: secondPoolId, status: 'IN_PROGRESS' });
    });

    it('lets the driver start one of two OPEN pools, since OPEN is not a ride', async () => {
      const { id: secondPoolId } = (await createPool(token)).body.data.pool;

      const response = await startPool(token, secondPoolId);

      expect(response.status).toBe(200);
      expect(response.body.data.pool).toMatchObject({ id: secondPoolId, status: 'IN_PROGRESS' });
    });

    it('does not block a second driver who is riding at the same time', async () => {
      const { token: otherToken, otherPoolId } = await otherDriverWithPool();

      await startPool(token, poolId);

      const response = await startPool(otherToken, otherPoolId);

      expect(response.status).toBe(200);
      expect(response.body.data.pool).toMatchObject({ id: otherPoolId, status: 'IN_PROGRESS' });
    });

    it('rejects a concurrent start of two pools with exactly one 200', async () => {
      const { id: secondPoolId } = (await createPool(token)).body.data.pool;

      const responses = await Promise.all([
        startPool(token, poolId),
        startPool(token, secondPoolId),
      ]);

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 409]);

      const failed = responses.find((response) => response.status === 409);
      expect(failed.body.message).toBe('Driver already has an active ride');

      const stored = await prisma.pool.findMany({ where: { id: { in: [poolId, secondPoolId] } } });
      const inProgress = stored.filter((pool) => pool.status === 'IN_PROGRESS');
      expect(inProgress).toHaveLength(1);
    });

    /**
     * The actual regression guard for the race, and it deliberately does not go
     * through HTTP.
     *
     * The HTTP test above passes with or without the driver row lock, because
     * two supertest requests rarely overlap inside the guard's read window. This
     * one calls the service twice in the same tick so both transactions really do
     * read "no active ride" before either commits. Measured on this suite, that
     * arrangement produced two `IN_PROGRESS` pools in 11 of 12 rounds with the
     * lock removed, and 0 of 12 with it in place -- which is what makes this the
     * test that would actually catch a regression, rather than one that only
     * appears to.
     */
    it('never lets two parallel service calls both claim the active ride', async () => {
      const firstDriver = await onboardedDriver(
        { name: 'First Driver', email: 'first-racer@example.com' },
        { ...vehicle, plateNumber: 'RACE-1' },
      );
      const { id: firstPool } = (await createPool(firstDriver.token)).body.data.pool;
      const { id: firstSecondPool } = (await createPool(firstDriver.token)).body.data.pool;

      const results = await Promise.allSettled([
        startPoolForUser(firstDriver.userId, firstPool),
        startPoolForUser(firstDriver.userId, firstSecondPool),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

      const rejection = results.find((result) => result.status === 'rejected');
      expect(rejection.reason).toMatchObject({
        statusCode: 409,
        message: 'Driver already has an active ride',
      });

      const stored = await prisma.pool.findMany({
        where: { id: { in: [firstPool, firstSecondPool] } },
      });
      expect(stored.filter((pool) => pool.status === 'IN_PROGRESS')).toHaveLength(1);
    });

    it('survives repeated parallel starts without ever doubling up', async () => {
      // One round proves little on its own; the race reproduced in 11 of 12
      // rounds before the lock, so this repeats it and asserts the invariant
      // never breaks rather than trusting a single interleaving.
      for (let round = 0; round < 6; round += 1) {
        const racer = await onboardedDriver(
          { name: `Racer ${round}`, email: `racer-${round}@example.com` },
          { ...vehicle, plateNumber: `RACE-LOOP-${round}` },
        );

        const first = (await createPool(racer.token)).body.data.pool;
        const second = (await createPool(racer.token)).body.data.pool;

        await Promise.allSettled([
          startPoolForUser(racer.userId, first.id),
          startPoolForUser(racer.userId, second.id),
        ]);

        const stored = await prisma.pool.findMany({
          where: { id: { in: [first.id, second.id] } },
        });

        expect(stored.filter((pool) => pool.status === 'IN_PROGRESS')).toHaveLength(1);
      }
    });

    it('reports the conflict when the rule is called straight on the service', async () => {
      const secondPoolId = await driverWithRideInProgress();

      // The rule is service-layer logic, so the guarantee has to hold for a
      // direct call too, not only for a request that went through the controller.
      await expect(startPoolForUser(userId, secondPoolId)).rejects.toMatchObject({
        statusCode: 409,
        message: 'Driver already has an active ride',
      });
    });

    it('keeps the rule per driver when two drivers start concurrently', async () => {
      const other = await otherDriverWithPool();

      const responses = await Promise.all([
        startPool(token, poolId),
        startPool(other.token, other.otherPoolId),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);

      const stored = await prisma.pool.findMany({
        where: { id: { in: [poolId, other.otherPoolId] } },
      });
      expect(stored.every((pool) => pool.status === 'IN_PROGRESS')).toBe(true);
    });

    it('still answers 404 for a pool belonging to another driver', async () => {
      const { otherPoolId } = await otherDriverWithPool();
      await startPool(token, poolId);

      const response = await startPool(token, otherPoolId);

      // The rule must not turn a foreign pool into a 409, which would confirm
      // the pool id exists and hand one driver an oracle for others' ids.
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Pool not found');
    });
  });
});

describe('PATCH /api/pools/:poolId/complete', () => {
  let token;
  let userId;
  let poolId;

  beforeEach(async () => {
    ({ token, userId } = await onboardedDriver());
    ({ id: poolId } = (await createPool(token)).body.data.pool);
  });

  /**
   * Puts the pool into IN_PROGRESS, the only state completion accepts. Each test
   * calls it explicitly instead of the `beforeEach` doing it, because members
   * can only be added while the pool is still OPEN.
   */
  const start = () => startPool(token, poolId);

  it('lets a driver complete their own pool that is in progress', async () => {
    await start();

    const response = await completePool(token, poolId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Pool completed successfully',
    });
    expect(response.body.data.pool).toMatchObject({ id: poolId, status: 'COMPLETED' });
  });

  it('persists the pool as COMPLETED', async () => {
    await start();

    const { id } = (await completePool(token, poolId)).body.data.pool;

    const stored = await prisma.pool.findUnique({ where: { id } });
    expect(stored.status).toBe('COMPLETED');
  });

  it('stamps completedAt at the moment of the transition', async () => {
    await start();

    const before = new Date();
    const { pool } = (await completePool(token, poolId)).body.data;
    const after = new Date();

    expect(pool.completedAt).not.toBeNull();
    const completedAt = new Date(pool.completedAt);
    expect(completedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(completedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('leaves startedAt exactly as the start wrote it', async () => {
    await start();
    const startedAt = (await prisma.pool.findUnique({ where: { id: poolId } })).startedAt;

    const { pool } = (await completePool(token, poolId)).body.data;

    expect(new Date(pool.startedAt).toISOString()).toBe(startedAt.toISOString());
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).startedAt.toISOString()).toBe(
      startedAt.toISOString(),
    );
  });

  it('accepts a request with no body at all', async () => {
    await start();

    const response = await request(app)
      .patch(`/api/pools/${poolId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.data.pool.status).toBe('COMPLETED');
  });

  it('moves every ride request to COMPLETED', async () => {
    const members = await matchRideRequests(token, poolId, 2);
    await start();

    const response = await completePool(token, poolId);
    expect(response.status).toBe(200);

    for (const { rideRequest } of members) {
      const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
      expect(stored.status).toBe('COMPLETED');
    }
  });

  it('settles each ride request at its own PoolMember fare', async () => {
    // Two different seat counts, so the two fares differ. A flat copy of one
    // member's fare onto every row would pass a single-member test and fail
    // this one.
    const first = await passengerWithRideRequest(
      { email: 'one@example.com' },
      { ...rideRequestPayload, seatsRequested: 1 },
    );
    const second = await passengerWithRideRequest(
      { email: 'two@example.com' },
      { ...rideRequestPayload, seatsRequested: 2 },
    );

    await addMember(token, poolId, { rideRequestId: first.rideRequest.id });
    await addMember(token, poolId, { rideRequestId: second.rideRequest.id });
    await startPool(token, poolId);
    await completePool(token, poolId);

    const memberRows = await prisma.poolMember.findMany({ where: { poolId } });
    expect(memberRows).toHaveLength(2);

    for (const member of memberRows) {
      const stored = await prisma.rideRequest.findUnique({
        where: { id: member.rideRequestId },
      });

      expect(stored.finalFarePaisa).toBe(member.farePaisa);
    }

    const fares = memberRows.map((member) => member.farePaisa);
    expect(fares[0]).not.toBe(fares[1]);
  });

  it('rejects a passenger with 403', async () => {
    await start();
    const passenger = await authenticate({
      name: 'Other Passenger',
      email: 'otherpassenger@example.com',
      role: 'PASSENGER',
    });

    const response = await completePool(passenger.token, poolId);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('IN_PROGRESS');
  });

  it('rejects an unauthenticated request with 401', async () => {
    await start();

    const response = await request(app).patch(`/api/pools/${poolId}/complete`).send();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('IN_PROGRESS');
  });

  it('rejects a garbage token with 401', async () => {
    await start();

    const response = await request(app)
      .patch(`/api/pools/${poolId}/complete`)
      .set('Authorization', 'Bearer not.a.jwt')
      .send();

    expect(response.status).toBe(401);
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('IN_PROGRESS');
  });

  it('rejects a malformed pool id with a field-level 400', async () => {
    await start();

    const response = await completePool(token, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toEqual([
      { field: 'poolId', message: 'Pool id must be a valid UUID' },
    ]);
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('IN_PROGRESS');
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    await start();
    const fresh = await authenticate({ name: 'No Profile', email: 'noprofile@example.com' });

    const response = await completePool(fresh.token, poolId);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Driver profile not found' });
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('IN_PROGRESS');
  });

  it('returns 404 for a pool that does not exist', async () => {
    await start();

    const response = await completePool(token, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Pool not found' });
  });

  it("returns the same 404 for another driver's pool", async () => {
    const { otherPoolId, token: otherToken } = await otherDriverWithPool();
    const { id: otherStartedId } = (await startPool(otherToken, otherPoolId)).body.data.pool;

    const response = await completePool(token, otherStartedId);
    const missing = await completePool(token, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Pool not found');
    expect(response.body.message).toBe(missing.body.message);
    expect((await prisma.pool.findUnique({ where: { id: otherStartedId } })).status).toBe(
      'IN_PROGRESS',
    );
  });

  it('rejects a pool that is still OPEN with 409', async () => {
    const { id: openPoolId } = (await createPool(token)).body.data.pool;

    const response = await completePool(token, openPoolId);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, message: 'Pool is not in progress' });
    expect((await prisma.pool.findUnique({ where: { id: openPoolId } })).completedAt).toBeNull();
  });

  it.each(['COMPLETED', 'CANCELLED'])('rejects a %s pool with 409', async (status) => {
    await prisma.pool.update({ where: { id: poolId }, data: { status } });

    const response = await completePool(token, poolId);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Pool is not in progress');
  });

  it('cannot be completed twice', async () => {
    await start();
    expect((await completePool(token, poolId)).status).toBe(200);

    const first = await prisma.pool.findUnique({ where: { id: poolId } });
    const second = await completePool(token, poolId);

    expect(second.status).toBe(409);
    // The rejected completion must not have restamped the row.
    const stored = await prisma.pool.findUnique({ where: { id: poolId } });
    expect(stored.completedAt.toISOString()).toBe(first.completedAt.toISOString());
  });

  it('rolls back the pool transition when a member cannot be settled', async () => {
    // A membership whose ride request is put back to MATCHED, which the
    // conditional cascade refuses. Starting the pool has already moved it to
    // IN_PROGRESS, so this state can only be staged directly. The pool update
    // has already succeeded when the member write fails, so this is a real proof
    // of atomicity: the pool has to be back to IN_PROGRESS with no completedAt,
    // which can only happen if that successful write was rolled back.
    const { rideRequest } = await passengerWithRideRequest(
      { email: 'stuck@example.com' },
      { ...rideRequestPayload, seatsRequested: 1 },
    );
    await addMember(token, poolId, { rideRequestId: rideRequest.id });
    await start();
    await prisma.rideRequest.update({ where: { id: rideRequest.id }, data: { status: 'MATCHED' } });

    const startedAt = (await prisma.pool.findUnique({ where: { id: poolId } })).startedAt;
    const response = await completePool(token, poolId);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Ride request cannot be completed in its current status',
    });

    const stored = await prisma.pool.findUnique({ where: { id: poolId } });
    expect(stored.status).toBe('IN_PROGRESS');
    expect(stored.completedAt).toBeNull();
    expect(stored.startedAt.toISOString()).toBe(startedAt.toISOString());

    const rideRequestRow = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
    expect(rideRequestRow.status).toBe('MATCHED');
    expect(rideRequestRow.finalFarePaisa).toBeNull();
  });

  it('settles no member at all when one of them fails', async () => {
    // Two members, one of them unsettleable. The cascade has no defined member
    // order, so this asserts the order-independent outcome: after the rollback
    // nothing is COMPLETED and no fare was written anywhere.
    const first = await passengerWithRideRequest(
      { email: 'first@example.com' },
      { ...rideRequestPayload, seatsRequested: 1 },
    );
    const second = await passengerWithRideRequest(
      { email: 'second@example.com' },
      { ...rideRequestPayload, seatsRequested: 1 },
    );

    await addMember(token, poolId, { rideRequestId: first.rideRequest.id });
    await addMember(token, poolId, { rideRequestId: second.rideRequest.id });
    await start();
    await prisma.rideRequest.update({ where: { id: second.rideRequest.id }, data: { status: 'MATCHED' } });

    expect((await completePool(token, poolId)).status).toBe(409);

    const completed = await prisma.rideRequest.count({ where: { status: 'COMPLETED' } });
    const settled = await prisma.rideRequest.count({ where: { finalFarePaisa: { not: null } } });
    expect(completed).toBe(0);
    expect(settled).toBe(0);
    expect((await prisma.pool.findUnique({ where: { id: poolId } })).status).toBe('IN_PROGRESS');
  });

  it('lets only one of two concurrent completions succeed', async () => {
    await start();

    const [first, second] = await Promise.all([
      completePool(token, poolId),
      completePool(token, poolId),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const stored = await prisma.pool.findUnique({ where: { id: poolId } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.completedAt).not.toBeNull();
    expect(await prisma.pool.count({ where: { status: 'COMPLETED' } })).toBe(1);
  });

  it('returns exactly the documented DTO fields', async () => {
    await start();

    const { pool } = (await completePool(token, poolId)).body.data;

    expect(Object.keys(pool).sort()).toEqual(
      ['id', 'driverId', 'vehicleId', 'status', 'startedAt', 'completedAt', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('never exposes the driver, the vehicle, the members or a credential', async () => {
    await start();

    const response = await completePool(token, poolId);
    const { pool } = response.body.data;

    expect(pool).not.toHaveProperty('driver');
    expect(pool).not.toHaveProperty('vehicle');
    expect(pool).not.toHaveProperty('members');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(driver.password);
  });

  it('ignores a forged finalFarePaisa, status and startedAt in the body', async () => {
    const { rideRequest } = await passengerWithRideRequest(
      { email: 'forger@example.com' },
      { ...rideRequestPayload, seatsRequested: 1 },
    );
    await addMember(token, poolId, { rideRequestId: rideRequest.id });
    await startPool(token, poolId);

    const startedAt = (await prisma.pool.findUnique({ where: { id: poolId } })).startedAt;
    const farePaisa = (
      await prisma.poolMember.findFirst({ where: { poolId, rideRequestId: rideRequest.id } })
    ).farePaisa;

    const response = await completePool(token, poolId, {
      finalFarePaisa: 1,
      status: 'CANCELLED',
      startedAt: '1999-01-01T00:00:00.000Z',
      completedAt: '1999-01-01T00:00:00.000Z',
      driverId: randomUUID(),
      vehicleId: randomUUID(),
    });

    expect(response.status).toBe(200);
    expect(response.body.data.pool.status).toBe('COMPLETED');
    expect(new Date(response.body.data.pool.startedAt).toISOString()).toBe(
      startedAt.toISOString(),
    );

    const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.finalFarePaisa).toBe(farePaisa);
    expect(stored.finalFarePaisa).not.toBe(1);
  });

  it('ignores extra arguments handed straight to the service, not just over HTTP', async () => {
    const { rideRequest } = await passengerWithRideRequest(
      { email: 'direct@example.com' },
      { ...rideRequestPayload, seatsRequested: 1 },
    );
    await addMember(token, poolId, { rideRequestId: rideRequest.id });
    await startPool(token, poolId);

    const startedAt = (await prisma.pool.findUnique({ where: { id: poolId } })).startedAt;
    const farePaisa = (
      await prisma.poolMember.findFirst({ where: { poolId, rideRequestId: rideRequest.id } })
    ).farePaisa;

    const pool = await completePoolForUser(userId, poolId, {
      finalFarePaisa: 1,
      status: 'CANCELLED',
      startedAt: '1999-01-01T00:00:00.000Z',
      completedAt: '1999-01-01T00:00:00.000Z',
    });

    expect(pool).toMatchObject({ id: poolId, status: 'COMPLETED' });
    expect(new Date(pool.startedAt).toISOString()).toBe(startedAt.toISOString());

    const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.finalFarePaisa).toBe(farePaisa);
    expect(stored.finalFarePaisa).not.toBe(1);
  });
});
