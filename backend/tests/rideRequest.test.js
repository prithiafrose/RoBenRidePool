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
