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

/**
 * A departure window the API accepts, built from the clock rather than written
 * down as a literal.
 *
 * `departureFrom` must not be in the past, so a hard-coded date would make this
 * fixture rot into a 400 on the day it expired. Offsetting from `Date.now()`
 * keeps it valid forever, and emitting `Z` matches the UTC instants the API
 * stores. `startPool` helpers elsewhere use the same "24 hours out" offset.
 */
const futureWindow = (hoursFromNow = 24) => {
  const departureFrom = new Date(Date.now() + hoursFromNow * 3_600_000);

  return {
    departureFrom: departureFrom.toISOString(),
    departureTo: new Date(departureFrom.getTime() + 3_600_000).toISOString(),
  };
};

const rideRequest = {
  pickupArea: 'Dhanmondi',
  destinationArea: 'Gulshan',
  seatsRequested: 2,
  ...futureWindow(),
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
        'departureFrom',
        'departureTo',
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
        'departureFrom',
        'departureTo',
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

/**
 * The departure window is a first-class part of a ride request: `README.md` says a
 * passenger requests "an origin, a destination and a time window", and
 * `docs/architecture.md` lists "departure window" among `RideRequest`'s
 * responsibilities. These tests are grouped together rather than spread across the
 * four endpoint suites because the rules are about the field itself, and because
 * the interesting cases are rejections that belong to creation.
 */
describe('RideRequest departure window', () => {
  let token;
  let userId;

  beforeEach(async () => {
    ({ token, userId } = await authenticate());
  });

  const create = (payload) => createRide(token, payload);

  /** A specific window, so a test can assert on the exact instants it asked for. */
  const windowOf = (from, to) => ({ ...rideRequest, departureFrom: from, departureTo: to });

  it('persists the window on the created request', async () => {
    // The window is built once and reused in the assertion: calling
    // `futureWindow()` twice would produce two different instants, because each
    // call offsets from a freshly read clock.
    const window = futureWindow();

    const response = await create({ ...rideRequest, ...window });

    expect(response.status).toBe(201);

    const stored = await prisma.rideRequest.findUnique({
      where: { id: response.body.data.rideRequest.id },
    });
    expect(stored.departureFrom.toISOString()).toBe(window.departureFrom);
    expect(stored.departureTo.toISOString()).toBe(window.departureTo);
  });

  it('returns both fields on the created request', async () => {
    const window = futureWindow();

    const response = await create({ ...rideRequest, ...window });

    expect(response.status).toBe(201);
    expect(response.body.data.rideRequest.departureFrom).toBe(window.departureFrom);
    expect(response.body.data.rideRequest.departureTo).toBe(window.departureTo);
  });

  it('returns both fields on the collection listing', async () => {
    const created = await createOne(token);

    const response = await listRides(token);

    expect(response.status).toBe(200);
    const listed = response.body.data.rideRequests.find((item) => item.id === created.id);
    expect(listed.departureFrom).toBe(created.departureFrom);
    expect(listed.departureTo).toBe(created.departureTo);
  });

  it('returns both fields on the single request endpoint', async () => {
    const created = await createOne(token);

    const response = await getRide(token, created.id);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequest.departureFrom).toBe(created.departureFrom);
    expect(response.body.data.rideRequest.departureTo).toBe(created.departureTo);
  });

  it('stores an offset timestamp as the UTC instant it denotes', async () => {
    // 08:00+06:00 is 02:00 UTC, so this pins the conversion rather than merely
    // accepting the string: a server that stored the wall-clock digits would
    // answer 08:00Z and fail here.
    const response = await create(
      windowOf('2026-10-01T08:00:00+06:00', '2026-10-01T09:30:00+06:00'),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.rideRequest.departureFrom).toBe('2026-10-01T02:00:00.000Z');
    expect(response.body.data.rideRequest.departureTo).toBe('2026-10-01T03:30:00.000Z');

    const stored = await prisma.rideRequest.findUnique({
      where: { id: response.body.data.rideRequest.id },
    });
    expect(stored.departureFrom.toISOString()).toBe('2026-10-01T02:00:00.000Z');
  });

  it('treats an offset timestamp and its Z equivalent as the same instant', async () => {
    const withOffset = await create(
      windowOf('2026-10-01T08:00:00+06:00', '2026-10-01T09:00:00+06:00'),
    );
    const withZ = await create(windowOf('2026-10-01T02:00:00Z', '2026-10-01T03:00:00Z'));

    expect(withOffset.body.data.rideRequest.departureFrom).toBe(
      withZ.body.data.rideRequest.departureFrom,
    );
    expect(withOffset.body.data.rideRequest.departureTo).toBe(withZ.body.data.rideRequest.departureTo);
  });

  it('rejects a window whose bounds are equal', async () => {
    const at = futureWindow().departureFrom;
    const response = await create(windowOf(at, at));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details[0].field).toBe('departureTo');
  });

  it('rejects a window that ends before it starts', async () => {
    const from = futureWindow(48).departureFrom;
    const to = futureWindow(24).departureTo;
    const response = await create(windowOf(from, to));

    expect(response.status).toBe(400);
    expect(response.body.details[0].field).toBe('departureTo');
  });

  it.each([
    ['a missing departureFrom', 'departureFrom'],
    ['a missing departureTo', 'departureTo'],
  ])('rejects %s with 400 and a field error', async (_label, field) => {
    const payload = { ...rideRequest };
    delete payload[field];

    const response = await create(payload);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details.some((detail) => detail.field === field)).toBe(true);
  });

  it('rejects a naive datetime that carries no offset', async () => {
    const response = await create(windowOf('2026-10-01T08:00:00', '2026-10-01T09:00:00'));

    expect(response.status).toBe(400);
    expect(response.body.details.some((detail) => detail.field === 'departureFrom')).toBe(true);
  });

  it.each([
    ['an epoch millisecond number', 1_778_000_000_000],
    ['a fractional number', 1_778_000_000_000.5],
  ])('rejects %s without coercing it to a string', async (_label, value) => {
    const response = await create(windowOf(value, futureWindow(48).departureTo));

    expect(response.status).toBe(400);
    expect(response.body.details.some((detail) => detail.field === 'departureFrom')).toBe(true);
  });

  it('rejects a departure window that has already started', async () => {
    const response = await create(
      windowOf('2020-01-01T08:00:00Z', '2020-01-01T09:00:00Z'),
    );

    expect(response.status).toBe(400);
    expect(response.body.details.some((detail) => detail.field === 'departureFrom')).toBe(true);
  });

  it('reports the past departure only once, not also as an ordering failure', async () => {
    const response = await create(windowOf('2020-01-01T08:00:00Z', '2020-01-01T09:00:00Z'));

    expect(response.status).toBe(400);
    const fields = response.body.details.map((detail) => detail.field);
    expect(fields).toContain('departureFrom');
    expect(fields).not.toContain('departureTo');
  });

  it('rejects a window that has already started even when it has not ended', async () => {
    // The rule is on `departureFrom`, not on whether the window is still open, so
    // a window that began an hour ago is refused even though `departureTo` is
    // still in the future. Documented here because it is a consequence worth
    // being deliberate about rather than a case that falls out by accident.
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = futureWindow(2).departureTo;

    const response = await create(windowOf(from, to));

    expect(response.status).toBe(400);
    expect(response.body.details.some((detail) => detail.field === 'departureFrom')).toBe(true);
  });

  it('accepts a window that ends far in the future, having no horizon rule', async () => {
    const response = await create(
      windowOf(futureWindow(48).departureFrom, '2099-01-01T00:00:00Z'),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.rideRequest.departureTo).toBe('2099-01-01T00:00:00.000Z');
  });

  it('ignores a forged fare, status and passenger, as it did before', async () => {
    const response = await createRide(token, {
      ...rideRequest,
      estimatedFarePaisa: 1,
      finalFarePaisa: 1,
      status: 'MATCHED',
      passengerId: randomUUID(),
    });

    expect(response.status).toBe(201);

    const created = response.body.data.rideRequest;
    // Asserting the server values rather than a fare figure, so this test is
    // about who owns each column and not about the placeholder fare table.
    expect(created.estimatedFarePaisa).not.toBe(1);
    expect(created.finalFarePaisa).toBeNull();
    expect(created.status).toBe('WAITING');
    expect(created.passengerId).toBe(userId);
  });

  it('keeps the window through a cancellation', async () => {
    const created = await createOne(token);

    const response = await cancelRide(token, created.id);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequest).toMatchObject({
      departureFrom: created.departureFrom,
      departureTo: created.departureTo,
      status: 'CANCELLED',
    });

    const stored = await prisma.rideRequest.findUnique({ where: { id: created.id } });
    expect(stored.departureFrom.toISOString()).toBe(created.departureFrom);
    expect(stored.departureTo.toISOString()).toBe(created.departureTo);
  });
});
