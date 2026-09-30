import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import {
  addPoolMember as addPoolMemberForUser,
  createPool as createPoolForUser,
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
