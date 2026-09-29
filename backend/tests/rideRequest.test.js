import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const app = createApp();

const passenger = {
  name: 'Nusrat Jahan',
  email: 'nusrat@example.com',
  password: 'password123',
  role: 'PASSENGER',
};

const rideRequest = {
  pickupArea: 'Dhanmondi',
  destinationArea: 'Gulshan',
  seatsRequested: 2,
};

const register = (payload = passenger) => request(app).post('/api/auth/register').send(payload);

/** Registers an account and returns the token plus the user id. */
const authenticate = async (overrides = {}) => {
  const { body } = await register({ ...passenger, ...overrides });
  return { token: body.data.token, userId: body.data.user.id };
};

const createRide = (token, payload = rideRequest) =>
  request(app).post('/api/ride-requests').set('Authorization', `Bearer ${token}`).send(payload);

describe('POST /api/ride-requests', () => {
  let token;
  let userId;

  beforeEach(async () => {
    ({ token, userId } = await authenticate());
  });

  it('creates a ride request for the authenticated passenger', async () => {
    const response = await createRide(token);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Ride request created successfully',
    });
    expect(response.body.data.rideRequest).toMatchObject({
      passengerId: userId,
      pickupArea: 'Dhanmondi',
      destinationArea: 'Gulshan',
      seatsRequested: 2,
    });
  });

  it('starts the request in WAITING status', async () => {
    const response = await createRide(token);

    expect(response.body.data.rideRequest.status).toBe('WAITING');
  });

  it('takes the passenger from the token, not the request body', async () => {
    const other = await authenticate({ email: 'other@example.com', name: 'Other' });

    const response = await createRide(token, { ...rideRequest, passengerId: other.userId });

    expect(response.status).toBe(201);
    expect(response.body.data.rideRequest.passengerId).toBe(userId);
    expect(response.body.data.rideRequest.passengerId).not.toBe(other.userId);
  });

  it('prices a request with the documented server-side formula', async () => {
    const response = await createRide(token, { ...rideRequest, seatsRequested: 1 });

    expect(response.status).toBe(201);
    // base 5000 + differentArea 8000 + (seats - 1) * perExtraSeat 1500
    expect(response.body.data.rideRequest.estimatedFarePaisa).toBe(13_000);
  });

  it('ignores a client-supplied estimatedFarePaisa', async () => {
    const response = await createRide(token, { ...rideRequest, estimatedFarePaisa: 1 });

    expect(response.status).toBe(201);
    expect(response.body.data.rideRequest.estimatedFarePaisa).toBeGreaterThan(1);
  });

  it('does not let the body override any server-owned field', async () => {
    const response = await createRide(token, {
      ...rideRequest,
      seatsRequested: 1,
      status: 'COMPLETED',
      finalFarePaisa: 1,
      estimatedFarePaisa: 1,
      passengerId: 'spoofed',
    });

    expect(response.status).toBe(201);

    const { id } = response.body.data.rideRequest;
    const stored = await prisma.rideRequest.findUnique({ where: { id } });

    expect(stored).toMatchObject({
      passengerId: userId,
      status: 'WAITING',
      estimatedFarePaisa: 13_000,
      finalFarePaisa: null,
    });
    expect(stored.passengerId).not.toBe('spoofed');
  });

  it('leaves the final fare null until the ride completes', async () => {
    const response = await createRide(token);

    expect(response.body.data.rideRequest.finalFarePaisa).toBeNull();
  });

  it('stores optional coordinates when both are supplied', async () => {
    const response = await createRide(token, {
      ...rideRequest,
      pickupLat: 23.7461,
      pickupLng: 90.3942,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.rideRequest).toMatchObject({
      pickupLat: 23.7461,
      pickupLng: 90.3942,
      destinationLat: null,
    });
  });

  it('prices a same-area trip below a cross-area trip', async () => {
    const sameArea = await createRide(token, { ...rideRequest, destinationArea: 'Dhanmondi' });
    const crossArea = await createRide(token, { ...rideRequest, destinationArea: 'Uttara' });

    expect(sameArea.body.data.rideRequest.estimatedFarePaisa).toBeLessThan(
      crossArea.body.data.rideRequest.estimatedFarePaisa,
    );
  });

  it('charges more for more seats', async () => {
    const one = await createRide(token, { ...rideRequest, seatsRequested: 1 });
    const three = await createRide(token, { ...rideRequest, seatsRequested: 3 });

    expect(three.body.data.rideRequest.estimatedFarePaisa).toBeGreaterThan(
      one.body.data.rideRequest.estimatedFarePaisa,
    );
  });

  it('does not expose the passenger record or a password hash', async () => {
    const response = await createRide(token);

    expect(response.body.data.rideRequest).not.toHaveProperty('passenger');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(passenger.password);
  });

  it('actually persists the row', async () => {
    const { body } = await createRide(token);
    const { id } = body.data.rideRequest;

    const stored = await prisma.rideRequest.findUnique({ where: { id } });

    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      passengerId: userId,
      pickupArea: 'Dhanmondi',
      destinationArea: 'Gulshan',
      seatsRequested: 2,
      status: 'WAITING',
      finalFarePaisa: null,
    });
    expect(stored.estimatedFarePaisa).toBe(body.data.rideRequest.estimatedFarePaisa);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).post('/api/ride-requests').send(rideRequest);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a driver with 403', async () => {
    const driver = await authenticate({
      email: 'rafiq@example.com',
      name: 'Rafiq Islam',
      role: 'DRIVER',
    });

    const response = await createRide(driver.token);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
  });

  it.each([
    ['a missing pickup area', { destinationArea: 'Gulshan', seatsRequested: 1 }],
    ['a missing destination area', { pickupArea: 'Dhanmondi', seatsRequested: 1 }],
    ['a missing seat count', { pickupArea: 'Dhanmondi', destinationArea: 'Gulshan' }],
    ['zero seats', { ...rideRequest, seatsRequested: 0 }],
    ['negative seats', { ...rideRequest, seatsRequested: -1 }],
    ['fractional seats', { ...rideRequest, seatsRequested: 1.5 }],
    ['more than ten seats', { ...rideRequest, seatsRequested: 11 }],
    ['a one-character area', { ...rideRequest, pickupArea: 'A' }],
    ['an over-long area', { ...rideRequest, destinationArea: 'x'.repeat(81) }],
    ['an empty body', {}],
  ])('rejects %s with 400 and field errors', async (_label, payload) => {
    const response = await createRide(token, payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details.length).toBeGreaterThan(0);
    expect(response.body.details[0]).toHaveProperty('field');
  });

  it.each([
    ['a latitude above 90', { pickupLat: 91, pickupLng: 90.3942 }],
    ['a latitude below -90', { pickupLat: -91, pickupLng: 90.3942 }],
    ['a longitude above 180', { destinationArea: 'Gulshan', destinationLat: 23.7, destinationLng: 181 }],
    ['a longitude below -180', { destinationLat: 23.7, destinationLng: -181 }],
    ['a non-numeric latitude', { pickupLat: 'north', pickupLng: 90.3942 }],
  ])('rejects %s with 400', async (_label, overrides) => {
    const response = await createRide(token, { ...rideRequest, ...overrides });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  it.each([
    ['a pickup latitude without a longitude', { pickupLat: 23.7461 }],
    ['a pickup longitude without a latitude', { pickupLng: 90.3942 }],
    ['a destination latitude without a longitude', { destinationLat: 23.7461 }],
    ['a destination longitude without a latitude', { destinationLng: 90.3942 }],
  ])('rejects %s with 400', async (_label, overrides) => {
    const response = await createRide(token, { ...rideRequest, ...overrides });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details[0].field).toMatch(/Lat|Lng/);
  });

  it('keeps a complete coordinate pair valid', async () => {
    const response = await createRide(token, {
      ...rideRequest,
      destinationLat: 23.7925,
      destinationLng: 90.4078,
    });

    expect(response.status).toBe(201);
  });
});

/** Creates requests for one passenger, waiting so `createdAt` cannot tie. */
const createSeveral = async (token, count) => {
  const created = [];

  for (let index = 0; index < count; index += 1) {
    const { body } = await createRide(token, {
      ...rideRequest,
      pickupArea: `Area ${index + 1}`,
    });

    created.push(body.data.rideRequest);
    // `createdAt` has millisecond precision, so back-to-back inserts can share a
    // timestamp. Spacing them keeps the newest-first assertion deterministic.
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return created;
};

const listRides = (token) => request(app).get('/api/ride-requests').set('Authorization', `Bearer ${token}`);

describe('GET /api/ride-requests', () => {
  let token;
  let userId;

  beforeEach(async () => {
    ({ token, userId } = await authenticate());
  });

  it('returns an empty list for a passenger with no requests', async () => {
    const response = await listRides(token);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Ride requests retrieved successfully',
    });
    expect(response.body.data.rideRequests).toEqual([]);
  });

  it("returns the passenger's own requests", async () => {
    const [created] = await createSeveral(token, 1);

    const response = await listRides(token);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequests).toHaveLength(1);
    expect(response.body.data.rideRequests[0]).toMatchObject({
      id: created.id,
      passengerId: userId,
      pickupArea: 'Area 1',
      destinationArea: 'Gulshan',
      seatsRequested: 2,
      status: 'WAITING',
      finalFarePaisa: null,
    });
  });

  it("never returns another passenger's requests", async () => {
    const other = await authenticate({ email: 'tariq@example.com', name: 'Tariq Rahman' });
    await createSeveral(token, 2);
    const [{ id: otherId }] = await createSeveral(other.token, 1);

    const response = await listRides(token);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequests).toHaveLength(2);

    for (const item of response.body.data.rideRequests) {
      expect(item.passengerId).toBe(userId);
    }

    expect(response.body.data.rideRequests.map((item) => item.id)).not.toContain(otherId);

    // The other passenger really does have a request, so the assertion above
    // is not passing just because the list happens to be empty.
    const otherList = await listRides(other.token);
    expect(otherList.body.data.rideRequests.map((item) => item.id)).toContain(otherId);
  });

  it('returns the newest request first', async () => {
    const created = await createSeveral(token, 3);

    const response = await listRides(token);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequests).toHaveLength(3);

    const timestamps = response.body.data.rideRequests.map((item) => new Date(item.createdAt).getTime());

    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeLessThanOrEqual(timestamps[index - 1]);
    }

    // The last request created is the newest, so it must come first.
    expect(response.body.data.rideRequests[0].id).toBe(created.at(-1).id);
  });

  it('never exposes the passenger record or a password hash', async () => {
    await createSeveral(token, 2);

    const response = await listRides(token);

    for (const item of response.body.data.rideRequests) {
      expect(item).not.toHaveProperty('passenger');
    }

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(passenger.password);
  });

  it('returns DTO fields that match the persisted row', async () => {
    const [created] = await createSeveral(token, 1);

    const response = await listRides(token);
    const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });

    expect(response.body.data.rideRequests[0]).toMatchObject({
      id: stored.id,
      passengerId: stored.passengerId,
      pickupArea: stored.pickupArea,
      destinationArea: stored.destinationArea,
      seatsRequested: stored.seatsRequested,
      estimatedFarePaisa: stored.estimatedFarePaisa,
      finalFarePaisa: stored.finalFarePaisa,
      status: stored.status,
    });
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).get('/api/ride-requests');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a driver with 403', async () => {
    const driver = await authenticate({
      email: 'rafiq@example.com',
      name: 'Rafiq Islam',
      role: 'DRIVER',
    });

    const response = await listRides(driver.token);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
  });
});

const getRide = (token, id) =>
  request(app)
    .get(`/api/ride-requests/${id}`)
    .set('Authorization', `Bearer ${token}`);

/** Creates one request and returns it, so the id under test comes from a real row. */
const createOne = async (token, overrides = {}) => {
  const { body } = await createRide(token, { ...rideRequest, ...overrides });

  return body.data.rideRequest;
};

describe('GET /api/ride-requests/:id', () => {
  let token;
  let userId;

  beforeEach(async () => {
    ({ token, userId } = await authenticate());
  });

  it("returns the passenger's own request", async () => {
    const created = await createOne(token);

    const response = await getRide(token, created.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Ride request retrieved successfully',
    });
    expect(response.body.data.rideRequest).toMatchObject({
      id: created.id,
      passengerId: userId,
      status: 'WAITING',
      finalFarePaisa: null,
    });
  });

  it("returns another passenger's request as 404, even though the row exists", async () => {
    const other = await authenticate({ email: 'tariq@example.com', name: 'Tariq Rahman' });
    const foreign = await createOne(other.token);

    // The row really is there, so the 404 below cannot pass vacuously.
    const stored = await prisma.rideRequest.findUnique({ where: { id: foreign.id } });
    expect(stored).not.toBeNull();
    expect(stored.passengerId).toBe(other.userId);
    expect(stored.passengerId).not.toBe(userId);

    const response = await getRide(token, foreign.id);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Ride request not found',
    });
    expect(response.body.data).toBeUndefined();
  });

  it('answers a foreign request exactly like a nonexistent one', async () => {
    const other = await authenticate({ email: 'sabina@example.com', name: 'Sabina Akter' });
    const foreign = await createOne(other.token);

    const foreignResponse = await getRide(token, foreign.id);
    const missingResponse = await getRide(token, randomUUID());

    // Same status, same message, same envelope keys: the response cannot be
    // used to learn that somebody else's id exists.
    expect(foreignResponse.status).toBe(missingResponse.status);
    expect(foreignResponse.body).toEqual(missingResponse.body);
    expect(Object.keys(foreignResponse.body).sort()).toEqual(
      Object.keys(missingResponse.body).sort(),
    );
  });

  it('returns 404 for a valid UUID that does not exist', async () => {
    const response = await getRide(token, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Ride request not found',
    });
  });

  it.each(['not-a-uuid', '123', 'abc-def'])(
    'rejects the malformed id %j with 400 and a field error',
    async (id) => {
      const response = await getRide(token, id);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.details.map((detail) => detail.field)).toContain('id');
    },
  );

  it('serves an empty id as the collection route, not as a bad :id', async () => {
    // `GET /api/ride-requests/` has no path segment after the router, so it
    // matches `router.get('/')` and never reaches `/:id` or `validateParams`.
    // An empty segment is indistinguishable from no segment, so this cannot be
    // turned into a 400 without breaking the collection endpoint. Pinned here
    // so the behaviour is deliberate rather than accidental.
    await createOne(token);

    const response = await getRide(token, '');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Ride requests retrieved successfully');
    expect(response.body.data.rideRequests).toHaveLength(1);
  });

  it('rejects a driver with 403', async () => {
    const driver = await authenticate({
      email: 'rafiq@example.com',
      name: 'Rafiq Islam',
      role: 'DRIVER',
    });
    const created = await createOne(token);

    const response = await getRide(driver.token, created.id);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const created = await createOne(token);

    const response = await request(app).get(`/api/ride-requests/${created.id}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a garbage token with 401', async () => {
    const created = await createOne(token);

    const response = await request(app)
      .get(`/api/ride-requests/${created.id}`)
      .set('Authorization', 'Bearer not.a.jwt');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('returns exactly the documented DTO fields', async () => {
    const created = await createOne(token);

    const response = await getRide(token, created.id);

    // Asserting the full key set, so a field added to `toRideRequest` without
    // review would fail here instead of leaking through unnoticed.
    expect(Object.keys(response.body.data.rideRequest).sort()).toEqual(
      [
        'id',
        'passengerId',
        'pickupArea',
        'pickupLat',
        'pickupLng',
        'destinationArea',
        'destinationLat',
        'destinationLng',
        'seatsRequested',
        'estimatedFarePaisa',
        'finalFarePaisa',
        'status',
        'createdAt',
      ].sort(),
    );
  });

  it('does not expose the passenger record or a password hash', async () => {
    const created = await createOne(token);

    const response = await getRide(token, created.id);

    expect(response.body.data.rideRequest).not.toHaveProperty('passenger');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(passenger.password);
  });

  it('returns DTO fields that match the persisted row', async () => {
    const created = await createOne(token);

    const response = await getRide(token, created.id);
    const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });

    expect(response.body.data.rideRequest).toMatchObject({
      id: stored.id,
      passengerId: stored.passengerId,
      pickupArea: stored.pickupArea,
      destinationArea: stored.destinationArea,
      seatsRequested: stored.seatsRequested,
      estimatedFarePaisa: stored.estimatedFarePaisa,
      finalFarePaisa: stored.finalFarePaisa,
      status: stored.status,
    });
  });
});

const cancelRide = (token, id) =>
  request(app)
    .patch(`/api/ride-requests/${id}/cancel`)
    .set('Authorization', `Bearer ${token}`);

/**
 * Test-only helper: forces a status that no endpoint can produce yet, so the
 * non-cancellable transitions can be exercised. Production code never sets a
 * status other than the Prisma default and the cancel transition itself.
 */
const forceStatus = async (id, status) => {
  const updated = await prisma.rideRequest.update({ where: { id }, data: { status } });

  return updated;
};

describe('PATCH /api/ride-requests/:id/cancel', () => {
  let token;
  let userId;

  beforeEach(async () => {
    ({ token, userId } = await authenticate());
  });

  it("cancels the passenger's own WAITING request", async () => {
    const created = await createOne(token);

    const response = await cancelRide(token, created.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Ride request cancelled successfully',
    });
    expect(response.body.data.rideRequest).toMatchObject({
      id: created.id,
      passengerId: userId,
      status: 'CANCELLED',
    });
  });

  it('actually persists the cancellation', async () => {
    const created = await createOne(token);

    await cancelRide(token, created.id);

    const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });
    expect(stored.status).toBe('CANCELLED');
  });

  it('returns DTO fields that match the persisted row', async () => {
    const created = await createOne(token);

    const response = await cancelRide(token, created.id);
    const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });

    expect(response.body.data.rideRequest).toMatchObject({
      id: stored.id,
      passengerId: stored.passengerId,
      pickupArea: stored.pickupArea,
      destinationArea: stored.destinationArea,
      seatsRequested: stored.seatsRequested,
      estimatedFarePaisa: stored.estimatedFarePaisa,
      finalFarePaisa: stored.finalFarePaisa,
      status: stored.status,
    });
  });

  it('returns exactly the documented DTO fields', async () => {
    const created = await createOne(token);

    const response = await cancelRide(token, created.id);

    expect(Object.keys(response.body.data.rideRequest).sort()).toEqual(
      [
        'id',
        'passengerId',
        'pickupArea',
        'pickupLat',
        'pickupLng',
        'destinationArea',
        'destinationLat',
        'destinationLng',
        'seatsRequested',
        'estimatedFarePaisa',
        'finalFarePaisa',
        'status',
        'createdAt',
      ].sort(),
    );
  });

  it('does not expose the passenger record or a password hash', async () => {
    const created = await createOne(token);

    const response = await cancelRide(token, created.id);

    expect(response.body.data.rideRequest).not.toHaveProperty('passenger');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(passenger.password);
  });

  it("refuses another passenger's request and leaves it untouched", async () => {
    const other = await authenticate({ email: 'tariq@example.com', name: 'Tariq Rahman' });
    const foreign = await createOne(other.token);

    const stored = await prisma.rideRequest.findUnique({ where: { id: foreign.id } });
    expect(stored).not.toBeNull();
    expect(stored.passengerId).toBe(other.userId);

    const response = await cancelRide(token, foreign.id);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Ride request not found',
    });

    // The refusal must not have cancelled the other passenger's request.
    const unchanged = await prisma.rideRequest.findUnique({ where: { id: foreign.id } });
    expect(unchanged.status).toBe('WAITING');
  });

  it('answers a foreign request exactly like a nonexistent one', async () => {
    const other = await authenticate({ email: 'sabina@example.com', name: 'Sabina Akter' });
    const foreign = await createOne(other.token);

    const foreignResponse = await cancelRide(token, foreign.id);
    const missingResponse = await cancelRide(token, randomUUID());

    expect(foreignResponse.status).toBe(missingResponse.status);
    expect(foreignResponse.body).toEqual(missingResponse.body);
    expect(Object.keys(foreignResponse.body).sort()).toEqual(
      Object.keys(missingResponse.body).sort(),
    );
  });

  it('returns 404 for a valid UUID that does not exist', async () => {
    const response = await cancelRide(token, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Ride request not found',
    });
  });

  it.each(['not-a-uuid', '123', 'abc-def'])(
    'rejects the malformed id %j with 400 and a field error',
    async (id) => {
      const response = await cancelRide(token, id);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.details.map((detail) => detail.field)).toContain('id');
    },
  );

  it('rejects a driver with 403', async () => {
    const driver = await authenticate({
      email: 'rafiq@example.com',
      name: 'Rafiq Islam',
      role: 'DRIVER',
    });
    const created = await createOne(token);

    const response = await cancelRide(driver.token, created.id);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const created = await createOne(token);

    const response = await request(app).patch(`/api/ride-requests/${created.id}/cancel`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a garbage token with 401', async () => {
    const created = await createOne(token);

    const response = await request(app)
      .patch(`/api/ride-requests/${created.id}/cancel`)
      .set('Authorization', 'Bearer not.a.jwt');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it.each(['MATCHED', 'IN_PROGRESS', 'COMPLETED'])(
    'rejects a %s request with 409 and leaves the status unchanged',
    async (status) => {
      const created = await createOne(token);
      await forceStatus(created.id, status);

      const response = await cancelRide(token, created.id);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        success: false,
        message: 'Ride request cannot be cancelled in its current status',
      });

      const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });
      expect(stored.status).toBe(status);
    },
  );

  it('rejects a second cancellation of an already CANCELLED request', async () => {
    const created = await createOne(token);
    await cancelRide(token, created.id);

    const response = await cancelRide(token, created.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Ride request cannot be cancelled in its current status');

    const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });
    expect(stored.status).toBe('CANCELLED');
  });

  it('rejects a concurrent double cancellation with exactly one 200', async () => {
    const created = await createOne(token);

    // The service guards the transition in the UPDATE predicate, so exactly one
    // of these can match the row and the other must fall through to the 409.
    const responses = await Promise.all([
      cancelRide(token, created.id),
      cancelRide(token, created.id),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);

    const failed = responses.find((response) => response.status === 409);
    expect(failed.body.message).toBe('Ride request cannot be cancelled in its current status');

    const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });
    expect(stored.status).toBe('CANCELLED');
  });

  it('does not touch a second WAITING request of the same passenger', async () => {
    const target = await createOne(token, { pickupArea: 'Dhanmondi' });
    const other = await createOne(token, { pickupArea: 'Gulshan' });

    const response = await cancelRide(token, target.id);
    expect(response.status).toBe(200);

    const stored = await prisma.rideRequest.findUnique({ where: { id: other.id } });
    expect(stored.status).toBe('WAITING');
  });

  it('shows the cancelled status in the collection listing', async () => {
    const created = await createOne(token);
    await cancelRide(token, created.id);

    const response = await listRides(token);

    expect(response.status).toBe(200);
    const listed = response.body.data.rideRequests.find((item) => item.id === created.id);
    expect(listed.status).toBe('CANCELLED');
  });
});
