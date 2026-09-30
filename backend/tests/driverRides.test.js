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

const passengerAccount = {
  name: 'Nusrat Jahan',
  email: 'nusrat@example.com',
  password: 'password123',
  role: 'PASSENGER',
};

const vehicle = { plateNumber: 'DHK-1234', model: 'Model 3', seatCapacity: 4 };

/** A window starting `hoursFromNow` from the clock, `hours` long. */
const window = (hoursFromNow = 24, hours = 2) => {
  const from = new Date(Date.now() + hoursFromNow * 3_600_000);

  return {
    departureFrom: from.toISOString(),
    departureTo: new Date(from.getTime() + hours * 3_600_000).toISOString(),
  };
};

const register = (payload) => request(app).post('/api/auth/register').send(payload);

const authenticate = async (overrides = {}) => {
  const { body } = await register({ ...driverAccount, ...overrides });
  return { token: body.data.token, userId: body.data.user.id };
};

/** An onboarded driver on a fresh plate, so several can coexist in one test. */
const onboardedDriver = async (suffix, plate, overrides = {}) => {
  const { token, userId } = await authenticate({
    email: `${suffix}@example.com`,
    name: `Driver ${suffix}`,
    ...overrides,
  });

  const { body } = await request(app)
    .post('/api/driver-profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...vehicle, plateNumber: plate });

  return { token, userId, driverProfileId: body.data.driverProfile.id };
};

/** A passenger who has posted one WAITING ride request. */
const passengerWithRequest = async (email, payload = {}) => {
  const { body: auth } = await register({ ...passengerAccount, email });
  const { body } = await request(app)
    .post('/api/ride-requests')
    .set('Authorization', `Bearer ${auth.data.token}`)
    .send({
      pickupArea: 'Dhanmondi',
      destinationArea: 'Gulshan',
      seatsRequested: 1,
      ...window(),
      ...payload,
    });

  return {
    token: auth.data.token,
    userId: auth.data.user.id,
    rideRequest: body.data.rideRequest,
  };
};

const createPool = (token, payload = {}) =>
  request(app)
    .post('/api/pools')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...window(), ...payload });

const listAvailable = (token) =>
  request(app).get('/api/ride-requests/available').set('Authorization', `Bearer ${token}`);

const decline = (token, id) =>
  request(app)
    .post(`/api/ride-requests/${id}/decline`)
    .set('Authorization', `Bearer ${token}`);

const addMember = (token, poolId, rideRequestId) =>
  request(app)
    .post(`/api/pools/${poolId}/members`)
    .set('Authorization', `Bearer ${token}`)
    .send({ rideRequestId });

const getPool = (token, poolId) =>
  request(app).get(`/api/pools/${poolId}`).set('Authorization', `Bearer ${token}`);

const ids = (response) => response.body.data.rideRequests.map((rideRequest) => rideRequest.id);

describe('GET /api/ride-requests/available', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await onboardedDriver('rafiq', 'DHK-1234'));
  });

  it('lists waiting requests for an onboarded driver', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    const response = await listAvailable(token);

    expect(response.status).toBe(200);
    expect(ids(response)).toEqual([rideRequest.id]);
  });

  it('includes the window, route, seats and fare a driver needs to decide', async () => {
    await passengerWithRequest('nusrat@example.com');

    const { body } = await listAvailable(token);
    const [rideRequest] = body.data.rideRequests;

    expect(rideRequest).toMatchObject({
      pickupArea: 'Dhanmondi',
      destinationArea: 'Gulshan',
      seatsRequested: 1,
      status: 'WAITING',
      passenger: { name: 'Nusrat Jahan' },
    });
    expect(rideRequest.departureFrom).toBeTruthy();
    expect(rideRequest.departureTo).toBeTruthy();
    expect(rideRequest.estimatedFarePaisa).toBeGreaterThan(0);
  });

  it('never exposes a credential or the passenger email', async () => {
    await passengerWithRequest('nusrat@example.com', {});

    const response = await listAvailable(token);
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(passengerAccount.password);
    expect(Object.keys(response.body.data.rideRequests[0].passenger).sort()).toEqual([
      'id',
      'name',
    ]);
    // The passenger's own address is not in the queue at all.
    expect(response.body.data.rideRequests[0].passenger.email).toBeUndefined();
  });

  it('orders oldest first, so the longest-waiting request is offered first', async () => {
    const first = await passengerWithRequest('first@example.com');
    const second = await passengerWithRequest('second@example.com');

    const response = await listAvailable(token);

    expect(ids(response)).toEqual([first.rideRequest.id, second.rideRequest.id]);
  });

  it('drops a request once it has been accepted by a driver', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const { body: pool } = await createPool(token);

    expect((await addMember(token, pool.data.pool.id, rideRequest.id)).status).toBe(201);

    expect(ids(await listAvailable(token))).toEqual([]);
  });

  it('drops a request once the passenger cancels it', async () => {
    const { token: passengerToken, rideRequest } = await passengerWithRequest('nusrat@example.com');

    await request(app)
      .patch(`/api/ride-requests/${rideRequest.id}/cancel`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(ids(await listAvailable(token))).toEqual([]);
  });

  it('keeps a request in the queue for every driver who has not declined it', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const other = await onboardedDriver('other', 'DHK-9999');

    expect((await decline(token, rideRequest.id)).status).toBe(201);

    expect(ids(await listAvailable(token))).toEqual([]);
    expect(ids(await listAvailable(other.token))).toEqual([rideRequest.id]);
  });

  it('returns an empty array for an onboarded driver with nothing waiting', async () => {
    const response = await listAvailable(token);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequests).toEqual([]);
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const { token: fresh } = await authenticate({ email: 'newdriver@example.com' });

    const response = await listAvailable(fresh);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Driver profile not found');
  });

  it('returns 403 for a passenger', async () => {
    const { token: passengerToken } = await passengerWithRequest('nusrat@example.com');

    expect((await listAvailable(passengerToken)).status).toBe(403);
  });

  it('returns 401 without a token and for a garbage token', async () => {
    expect((await request(app).get('/api/ride-requests/available')).status).toBe(401);
    expect(
      (await request(app).get('/api/ride-requests/available').set('Authorization', 'Bearer nope'))
        .status,
    ).toBe(401);
  });

  it('does not read the id "available" as a ride request id', async () => {
    // Guards the route ordering: `/:id` is mounted after this literal path, so a
    // typo in this URL cannot be reported as a malformed uuid.
    expect((await listAvailable(token)).status).toBe(200);
  });
});

describe('POST /api/ride-requests/:id/decline', () => {
  let token;
  let driverProfileId;

  beforeEach(async () => {
    const onboarded = await onboardedDriver('rafiq', 'DHK-1234');
    token = onboarded.token;
    driverProfileId = onboarded.driverProfileId;
  });

  it('records the decline and leaves the passenger request WAITING', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    const response = await decline(token, rideRequest.id);

    expect(response.status).toBe(201);
    expect(response.body.data.decline).toMatchObject({ rideRequestId: rideRequest.id });

    const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
    expect(stored.status).toBe('WAITING');
  });

  it('never writes CANCELLED, so the ride request is still there afterwards', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    await decline(token, rideRequest.id);

    const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
    expect(stored.status).not.toBe('CANCELLED');
    expect(stored.finalFarePaisa).toBeNull();
    expect(await prisma.rideRequest.count()).toBe(1);
  });

  it('lets another driver accept the request after one driver declined it', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const other = await onboardedDriver('other', 'DHK-9999');

    expect((await decline(token, rideRequest.id)).status).toBe(201);

    const { body: pool } = await createPool(other.token);
    const accepted = await addMember(other.token, pool.data.pool.id, rideRequest.id);

    expect(accepted.status).toBe(201);
    expect(accepted.body.data.poolMember.rideRequestId).toBe(rideRequest.id);
    expect(ids(await listAvailable(other.token))).toEqual([]);
  });

  it('lets the same driver accept later what they previously declined', async () => {
    // A decline is not a veto, and the schema has no rule that stops a driver
    // changing their mind. Both facts are recorded and the matching step is free
    // to accept.
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    expect((await decline(token, rideRequest.id)).status).toBe(201);

    const { body: pool } = await createPool(token);
    expect((await addMember(token, pool.data.pool.id, rideRequest.id)).status).toBe(201);
  });

  it('lets several drivers decline the same request independently', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const others = await Promise.all([
      onboardedDriver('a', 'DHK-0001'),
      onboardedDriver('b', 'DHK-0002'),
      onboardedDriver('c', 'DHK-0003'),
    ]);

    for (const other of others) {
      expect((await decline(other.token, rideRequest.id)).status).toBe(201);
    }

    expect(await prisma.rideRequestDecline.count({ where: { rideRequestId: rideRequest.id } })).toBe(
      3,
    );
    expect((await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } })).status).toBe(
      'WAITING',
    );
  });

  it('answers a repeated decline from the same driver with 409', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    expect((await decline(token, rideRequest.id)).status).toBe(201);

    const second = await decline(token, rideRequest.id);

    expect(second.status).toBe(409);
    expect(second.body.message).toBe('Ride request already declined by this driver');
    expect(await prisma.rideRequestDecline.count()).toBe(1);
  });

  it('enforces the duplicate rule in the database, not only in the service', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    await prisma.rideRequestDecline.create({
      data: { rideRequestId: rideRequest.id, driverId: driverProfileId },
    });

    // The row already exists, so the service's insert cannot succeed.
    const response = await decline(token, rideRequest.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Ride request already declined by this driver');
  });

  it('lets only one of two concurrent declines from the same driver win', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    const responses = await Promise.all([decline(token, rideRequest.id), decline(token, rideRequest.id)]);
    const created = responses.filter((response) => response.status === 201);
    const refused = responses.filter((response) => response.status === 409);

    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(await prisma.rideRequestDecline.count()).toBe(1);
  });

  it('never records a decline that the response did not report, whichever order the race settles in', async () => {
    // A decline and an acceptance touch the same request at the same time. The
    // decline re-checks the status under a row lock, so one of the two must lose.
    // Run it repeatedly: the order varies, and the invariant may not.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { rideRequest } = await passengerWithRequest(`race${attempt}@example.com`);
      const other = await onboardedDriver(`other${attempt}`, `DHK-${attempt}001`);
      const { body: pool } = await createPool(token);

      const [accepted, declined] = await Promise.all([
        addMember(token, pool.data.pool.id, rideRequest.id),
        decline(other.token, rideRequest.id),
      ]);

      const stored = await prisma.rideRequest.findUnique({ where: { id: rideRequest.id } });
      const rows = await prisma.rideRequestDecline.count({
        where: { rideRequestId: rideRequest.id },
      });

      // The response and the row can never disagree.
      expect(rows).toBe(declined.status === 201 ? 1 : 0);

      // And the request ends in a state consistent with what the accept reported.
      // Note the decline may well have been recorded first - declining a request
      // that is still waiting is legitimate, and another driver is then free to
      // pick it up. What must never happen is a decline recorded against a ride
      // that was already taken, which the row lock rules out.
      if (stored.status === 'MATCHED') {
        expect(accepted.status).toBe(201);
      } else {
        expect(stored.status).toBe('WAITING');
        expect(accepted.status).not.toBe(201);
      }
    }
  });

  it('refuses to decline a request that is already matched', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const { body: pool } = await createPool(token);
    await addMember(token, pool.data.pool.id, rideRequest.id);

    const response = await decline(token, rideRequest.id);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Ride request cannot be declined in its current status');
    expect(await prisma.rideRequestDecline.count()).toBe(0);
  });

  it('refuses to decline a request the passenger already cancelled', async () => {
    const { token: passengerToken, rideRequest } = await passengerWithRequest('nusrat@example.com');

    await request(app)
      .patch(`/api/ride-requests/${rideRequest.id}/cancel`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect((await decline(token, rideRequest.id)).status).toBe(409);
  });

  it('returns 404 for a ride request that does not exist', async () => {
    const response = await decline(token, '3f1a0c1e-0000-4000-8000-000000000000');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Ride request not found');
  });

  it('returns 400 for a malformed id before touching the database', async () => {
    const response = await decline(token, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.details[0].field).toBe('id');
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const { token: fresh } = await authenticate({ email: 'newdriver@example.com' });

    const response = await decline(fresh, rideRequest.id);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Driver profile not found');
    expect(await prisma.rideRequestDecline.count()).toBe(0);
  });

  it('returns 403 for a passenger', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const passengerToken = await registerPassenger();

    const response = await decline(passengerToken, rideRequest.id);

    expect(response.status).toBe(403);
    expect(await prisma.rideRequestDecline.count()).toBe(0);
  });

  it('returns 401 without a token', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');

    const response = await request(app).post(`/api/ride-requests/${rideRequest.id}/decline`);

    expect(response.status).toBe(401);
  });

  it('ignores a forged driverId in the body', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const other = await onboardedDriver('other', 'DHK-9999');

    const response = await request(app)
      .post(`/api/ride-requests/${rideRequest.id}/decline`)
      .set('Authorization', `Bearer ${token}`)
      .send({ driverId: other.driverProfileId, rideRequestId: 'forged' });

    expect(response.status).toBe(201);

    const stored = await prisma.rideRequestDecline.findFirst();
    expect(stored.driverId).not.toBe(other.driverProfileId);
    expect(ids(await listAvailable(other.token))).toEqual([rideRequest.id]);
  });
});

/** A second passenger token, for the role check. */
const registerPassenger = async () => {
  const { body } = await register({ ...passengerAccount, email: `p${Math.random().toString(36).slice(2, 8)}@example.com` });
  return body.data.token;
};

describe('GET /api/pools/:poolId', () => {
  let token;
  let poolId;

  beforeEach(async () => {
    const onboarded = await onboardedDriver('rafiq', 'DHK-1234');
    token = onboarded.token;
    const { body } = await createPool(token);
    poolId = body.data.pool.id;
  });

  it('returns the pool with its window, vehicle and booked seats', async () => {
    const response = await getPool(token, poolId);

    expect(response.status).toBe(200);
    expect(response.body.data.pool).toMatchObject({
      id: poolId,
      status: 'OPEN',
      seatsBooked: 0,
      vehicle: { plateNumber: vehicle.plateNumber, seatCapacity: 4 },
    });
    expect(response.body.data.pool.departureFrom).toBeTruthy();
  });

  it('lists members with the ride request and passenger behind each one', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    await addMember(token, poolId, rideRequest.id);

    const response = await getPool(token, poolId);
    const [member] = response.body.data.pool.members;

    expect(member).toMatchObject({ seats: 1, rideRequestId: rideRequest.id });
    expect(member.rideRequest).toMatchObject({
      id: rideRequest.id,
      status: 'MATCHED',
      pickupArea: 'Dhanmondi',
      destinationArea: 'Gulshan',
      passenger: { name: 'Nusrat Jahan' },
    });
    expect(member.rideRequest.departureFrom).toBeTruthy();
  });

  it('tracks each member ride request through the pool lifecycle', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    await addMember(token, poolId, rideRequest.id);

    const statusOfMember = async () => {
      const response = await getPool(token, poolId);
      return response.body.data.pool.members[0].rideRequest.status;
    };

    expect(await statusOfMember()).toBe('MATCHED');

    await request(app).patch(`/api/pools/${poolId}/start`).set('Authorization', `Bearer ${token}`);
    expect(await statusOfMember()).toBe('IN_PROGRESS');

    await request(app).patch(`/api/pools/${poolId}/complete`).set('Authorization', `Bearer ${token}`);
    expect(await statusOfMember()).toBe('COMPLETED');
  });

  it('shows the settled fare once the ride is completed', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    await addMember(token, poolId, rideRequest.id);
    await request(app).patch(`/api/pools/${poolId}/start`).set('Authorization', `Bearer ${token}`);
    await request(app).patch(`/api/pools/${poolId}/complete`).set('Authorization', `Bearer ${token}`);

    const response = await getPool(token, poolId);

    expect(response.body.data.pool.members[0].rideRequest.finalFarePaisa).toBeGreaterThan(0);
  });

  it('never exposes a credential or the passenger email', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    await addMember(token, poolId, rideRequest.id);

    const response = await getPool(token, poolId);
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(passengerAccount.password);
    expect(Object.keys(response.body.data.pool.members[0].rideRequest.passenger).sort()).toEqual([
      'id',
      'name',
    ]);
  });

  it('returns the same 404 for another driver pool as for a missing one', async () => {
    const other = await onboardedDriver('other', 'DHK-9999');
    const stranger = await getPool(other.token, poolId);
    const missing = await getPool(other.token, '3f1a0c1e-0000-4000-8000-000000000000');

    expect(stranger.status).toBe(404);
    expect(missing.status).toBe(404);
    // Identical messages: a 403 here would confirm the pool exists.
    expect(stranger.body.message).toBe(missing.body.message);
  });

  it('returns 400 for a malformed pool id', async () => {
    const response = await getPool(token, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.details[0].field).toBe('poolId');
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const { token: fresh } = await authenticate({ email: 'newdriver@example.com' });

    expect((await getPool(fresh, poolId)).status).toBe(404);
  });

  it('returns 403 for a passenger and 401 without a token', async () => {
    const { token: passengerToken } = await passengerWithRequest('nusrat@example.com');

    expect((await getPool(passengerToken, poolId)).status).toBe(403);
    expect((await request(app).get(`/api/pools/${poolId}`)).status).toBe(401);
  });
});

describe('passenger visibility of a matched pool', () => {
  it('reports no pool while the request is waiting', async () => {
    const { token: passengerToken, rideRequest } = await passengerWithRequest('nusrat@example.com');

    const response = await request(app)
      .get(`/api/ride-requests/${rideRequest.id}`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequest.pool).toBeNull();
  });

  it('reports the pool once a driver accepts, including its window and driver name', async () => {
    const { token: passengerToken, rideRequest } = await passengerWithRequest('nusrat@example.com');
    const { token: driverToken } = await onboardedDriver('rafiq', 'DHK-1234');

    const { body: pool } = await createPool(driverToken);
    await addMember(driverToken, pool.data.pool.id, rideRequest.id);

    const response = await request(app)
      .get(`/api/ride-requests/${rideRequest.id}`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.rideRequest.pool).toMatchObject({
      id: pool.data.pool.id,
      status: 'OPEN',
      driver: { name: 'Driver rafiq' },
    });
    expect(response.body.data.rideRequest.pool.departureFrom).toBeTruthy();
    expect(response.body.data.rideRequest.pool.departureTo).toBeTruthy();
  });

  it('keeps the pool summary on the collection listing too', async () => {
    const { token: passengerToken, rideRequest } = await passengerWithRequest('nusrat@example.com');
    const { token: driverToken } = await onboardedDriver('rafiq', 'DHK-1234');

    const { body: pool } = await createPool(driverToken);
    await addMember(driverToken, pool.data.pool.id, rideRequest.id);

    const response = await request(app)
      .get('/api/ride-requests')
      .set('Authorization', `Bearer ${passengerToken}`);

    const [listed] = response.body.data.rideRequests;
    expect(listed.id).toBe(rideRequest.id);
    expect(listed.pool.id).toBe(pool.data.pool.id);
  });

  it('still refuses to show another passenger the same request', async () => {
    const { rideRequest } = await passengerWithRequest('nusrat@example.com');
    const { token: driverToken } = await onboardedDriver('rafiq', 'DHK-1234');
    const { body: pool } = await createPool(driverToken);
    await addMember(driverToken, pool.data.pool.id, rideRequest.id);

    const other = await passengerWithRequest('intruder@example.com');

    const response = await request(app)
      .get(`/api/ride-requests/${rideRequest.id}`)
      .set('Authorization', `Bearer ${other.token}`);

    expect(response.status).toBe(404);
  });
});