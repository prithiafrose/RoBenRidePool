import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

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

/**
 * A window built from explicit instants rather than from the clock.
 *
 * The compatibility rule compares two stored UTC instants, so these tests can
 * place them wherever they like - including in the past. Only pool *creation*
 * insists the window is still ahead, and the tests below cover that separately.
 */
const window = (from, to) => ({
  departureFrom: new Date(from).toISOString(),
  departureTo: new Date(to).toISOString(),
});

/** `2026-10-01T08:00:00Z` unless a base is given. */
const at = (hour, minute = 0, base = Date.UTC(2026, 9, 1)) =>
  base + hour * 3_600_000 + minute * 60_000;

/** The window `createPool` sends when a test does not care about timing. */
const futureWindow = (hoursFromNow = 24, hours = 1) => {
  const departureFrom = new Date(Date.now() + hoursFromNow * 3_600_000);

  return {
    departureFrom: departureFrom.toISOString(),
    departureTo: new Date(departureFrom.getTime() + hours * 3_600_000).toISOString(),
  };
};

const register = (payload) => request(app).post('/api/auth/register').send(payload);

const authenticate = async (overrides = {}) => {
  const { body } = await register({ ...driver, ...overrides });
  return { token: body.data.token, userId: body.data.user.id };
};

/** Registers a driver and runs onboarding, returning the token. */
const onboardedDriver = async (overrides = {}, payload = vehicle) => {
  const { token, userId } = await authenticate(overrides);
  await request(app)
    .post('/api/driver-profile')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  return { token, userId };
};

const createPool = (token, payload) =>
  request(app)
    .post('/api/pools')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...futureWindow(), ...payload });

const addMember = (token, poolId, rideRequestId) =>
  request(app)
    .post(`/api/pools/${poolId}/members`)
    .set('Authorization', `Bearer ${token}`)
    .send({ rideRequestId });

/** Creates a passenger and posts a ride request with an explicit window. */
const rideRequestWithWindow = async (pool, overrides = {}, payload) => {
  const { body: auth } = await register({
    name: 'Nusrat Jahan',
    email: `nusrat${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'password123',
    role: 'PASSENGER',
    ...overrides,
  });

  const { body } = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${auth.data.token}`)
    .send({
      pickupArea: 'Dhanmondi',
      destinationArea: 'Gulshan',
      seatsRequested: 1,
      ...pool,
      ...payload,
    });

  return { status: body.success ? 201 : body.status, rideRequest: body.data?.rideRequest, body };
};

describe('POST /api/pools departure window validation', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await onboardedDriver());
  });

  it('stores a window given with an explicit numeric offset as the UTC instant', async () => {
    // 08:00+06:00 and 02:00Z are the same moment. Whichever form the client uses,
    // what lands in the column is the instant - this is what makes the overlap
    // comparison below meaningful across clients in different places.
    const response = await createPool(token, {
      departureFrom: '2026-10-01T08:00:00+06:00',
      departureTo: '2026-10-01T09:30:00+06:00',
    });

    expect(response.status).toBe(201);

    const stored = await prisma.pool.findUnique({ where: { id: response.body.data.pool.id } });
    expect(stored.departureFrom.toISOString()).toBe('2026-10-01T02:00:00.000Z');
    expect(stored.departureTo.toISOString()).toBe('2026-10-01T03:30:00.000Z');
  });

  it('rejects a naive datetime that states no offset', async () => {
    const response = await createPool(token, {
      departureFrom: '2026-10-01T08:00:00',
      departureTo: futureWindow().departureTo,
    });

    expect(response.status).toBe(400);
    expect(response.body.details[0].field).toBe('departureFrom');
    expect(response.body.details[0].message).toContain('explicit offset');
  });

  it('rejects a numeric timestamp rather than coercing it', async () => {
    const response = await createPool(token, {
      departureFrom: at(8),
      departureTo: futureWindow().departureTo,
    });

    expect(response.status).toBe(400);
    expect(response.body.details[0].field).toBe('departureFrom');
  });

  it('rejects equal bounds', async () => {
    const response = await createPool(token, window(at(8), at(8)));

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([
      { field: 'departureTo', message: 'departureTo must be later than departureFrom' },
    ]);
  });

  it('rejects inverted bounds', async () => {
    const response = await createPool(token, window(at(9), at(8)));

    expect(response.status).toBe(400);
    expect(response.body.details[0].message).toBe('departureTo must be later than departureFrom');
  });

  it('rejects a window that has already started', async () => {
    const response = await createPool(token, {
      departureFrom: new Date(Date.now() - 3_600_000).toISOString(),
      departureTo: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.details[0].message).toBe('departureFrom must not be in the past');
  });

  it('does not impose a horizon on how far ahead a pool may depart', async () => {
    // A month out is far enough that a "max advance booking" rule would show up
    // here. It must not: no such rule is documented, so none is enforced.
    const response = await createPool(token, window(at(8, 0, Date.now() + 30 * 86_400_000), at(9, 0, Date.now() + 30 * 86_400_000)));

    expect(response.status).toBe(201);
  });
});

describe('POST /api/pools/:poolId/members time-window compatibility', () => {
  let token;
  let poolId;

  /** Opens a pool whose window is exactly the one given. */
  const poolWithWindow = async (from, to) => {
    const { body } = await createPool(token, window(from, to));
    return body.data.pool.id;
  };

  beforeEach(async () => {
    ({ token } = await onboardedDriver());
    poolId = await poolWithWindow(at(8), at(10));
  });

  it('accepts a request window fully inside the pool window', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(8, 30), at(9)));

    const response = await addMember(token, poolId, rideRequest.id);

    expect(response.status).toBe(201);
    expect(response.body.data.poolMember.rideRequestId).toBe(rideRequest.id);
  });

  it('accepts a request window that contains the pool window', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(7), at(11)));

    expect((await addMember(token, poolId, rideRequest.id)).status).toBe(201);
  });

  it('accepts a request window identical to the pool window', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(8), at(10)));

    expect((await addMember(token, poolId, rideRequest.id)).status).toBe(201);
  });

  it('accepts a request window that only partially overlaps, at either end', async () => {
    const early = await rideRequestWithWindow(window(at(7), at(8, 30)));
    expect((await addMember(token, poolId, early.rideRequest.id)).status).toBe(201);

    const otherPool = await poolWithWindow(at(8), at(10));
    const late = await rideRequestWithWindow(window(at(9, 30), at(11)));
    expect((await addMember(token, otherPool, late.rideRequest.id)).status).toBe(201);
  });

  it('accepts an overlap of a single millisecond', async () => {
    // Proves the rule rejects *equality*, not "any overlap at all": the request
    // starts 1ms before the pool window closes.
    const { rideRequest } = await rideRequestWithWindow(window(at(10) - 1, at(11)));

    expect((await addMember(token, poolId, rideRequest.id)).status).toBe(201);
  });

  it('rejects a request window that ends exactly when the pool window starts', async () => {
    // The boundary case. The two windows share the single instant 08:00, but
    // there is no time at which the passenger could still be picked up, so this is
    // not a match. Half-open intervals are what make that fall out of the
    // comparison rather than needing a special case.
    const { rideRequest } = await rideRequestWithWindow(window(at(7), at(8)));

    const response = await addMember(token, poolId, rideRequest.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Pool departure window does not overlap the ride request departure window',
    );
  });

  it('rejects a request window that starts exactly when the pool window ends', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(10), at(11)));

    const response = await addMember(token, poolId, rideRequest.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Pool departure window does not overlap the ride request departure window',
    );
  });

  it('rejects a request window that ends before the pool window starts', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(6), at(7)));

    const response = await addMember(token, poolId, rideRequest.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Pool departure window does not overlap the ride request departure window',
    );
  });

  it('rejects a request window that starts after the pool window ends', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(11), at(12)));

    expect((await addMember(token, poolId, rideRequest.id)).status).toBe(409);
  });

  it('compares instants, so offsets describing the same overlap are accepted', async () => {
    // The pool leaves 02:00Z-04:00Z. The passenger writes that window in Dhaka
    // local time as 08:00+06:00-10:00+06:00, which reads as hours later than the
    // pool but is the very same interval. It must be accepted, which it only can
    // be if the comparison happens on instants rather than on wall-clock strings.
    const offsetPool = await poolWithWindow(at(2), at(4));

    const { body: auth } = await register({
      name: 'Nusrat Jahan',
      email: 'nusrat-offset@example.com',
      password: 'password123',
      role: 'PASSENGER',
    });

    const { body } = await request(app)
      .post('/api/ride-requests')
      .set('Authorization', `Bearer ${auth.data.token}`)
      .send({
        pickupArea: 'Dhanmondi',
        destinationArea: 'Gulshan',
        seatsRequested: 1,
        departureFrom: '2026-10-01T08:00:00+06:00',
        departureTo: '2026-10-01T10:00:00+06:00',
      });

    expect((await addMember(token, offsetPool, body.data.rideRequest.id)).status).toBe(201);
  });

  it('compares instants, so offsets describing no overlap are rejected', async () => {
    const offsetPool = await poolWithWindow(at(2), at(4));

    const { body: auth } = await register({
      name: 'Nusrat Jahan',
      email: 'nusrat-offset-2@example.com',
      password: 'password123',
      role: 'PASSENGER',
    });

    // 16:00+06:00 is 10:00Z, five hours after the pool window has closed.
    const { body } = await request(app)
      .post('/api/ride-requests')
      .set('Authorization', `Bearer ${auth.data.token}`)
      .send({
        pickupArea: 'Dhanmondi',
        destinationArea: 'Gulshan',
        seatsRequested: 1,
        departureFrom: '2026-10-01T16:00:00+06:00',
        departureTo: '2026-10-01T17:00:00+06:00',
      });

    expect((await addMember(token, offsetPool, body.data.rideRequest.id)).status).toBe(409);
  });

  it('leaves the request WAITING and creates no member when the window does not fit', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(11), at(12)));

    await addMember(token, poolId, rideRequest.id);

    const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
    expect(stored.status).toBe('WAITING');
    expect(await prisma.poolMember.count({ where: { rideRequestId: rideRequest.id } })).toBe(0);
  });

  it('reports the window problem rather than capacity when both would fail', async () => {
    // Two seats in a four-seat car leaves room, so this could only fail on the
    // window. The window message is the one that explains it.
    const { rideRequest } = await rideRequestWithWindow(window(at(11), at(12)), {}, { seatsRequested: 2 });

    const response = await addMember(token, poolId, rideRequest.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Pool departure window does not overlap the ride request departure window',
    );
  });

  it('reports capacity rather than the window when the window fits but the seats do not', async () => {
    const { rideRequest } = await rideRequestWithWindow(window(at(9), at(9, 30)), {}, { seatsRequested: 4 });

    const first = await addMember(token, poolId, rideRequest.id);
    expect(first.status).toBe(201);

    const second = await rideRequestWithWindow(window(at(9), at(9, 30)), {}, { seatsRequested: 1 });

    expect((await addMember(token, poolId, second.rideRequest.id)).status).toBe(409);
    expect(await prisma.poolMember.count({ where: { poolId } })).toBe(1);
  });

  it('checks the status before the window, so a taken request is a status conflict', async () => {
    const taken = await rideRequestWithWindow(window(at(9), at(9, 30)));
    expect((await addMember(token, poolId, taken.rideRequest.id)).status).toBe(201);

    // A different pool with a window that does *not* overlap. The request is
    // MATCHED now, so the status guard is what refuses it - which keeps the two
    // failures distinguishable instead of reporting a window problem for a
    // request that is simply gone.
    const disjointPool = await poolWithWindow(at(20), at(21));

    const response = await addMember(token, disjointPool, taken.rideRequest.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Ride request cannot be added to this pool in its current status',
    );
  });
});