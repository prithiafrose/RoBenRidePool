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

const register = (payload = driver) => request(app).post('/api/auth/register').send(payload);

/** Registers an account and returns the token plus the user id. */
const authenticate = async (overrides = {}) => {
  const { body } = await register({ ...driver, ...overrides });
  return { token: body.data.token, userId: body.data.user.id };
};

const onboard = (token, payload = vehicle) =>
  request(app).post('/api/driver-profile').set('Authorization', `Bearer ${token}`).send(payload);

/** Onboards a fresh driver and returns the parsed profile plus both ids. */
const createProfile = async (overrides = {}, payload = vehicle) => {
  const { token, userId } = await authenticate(overrides);
  const { body } = await onboard(token, payload);

  return { profile: body.data.driverProfile, userId, token };
};

describe('POST /api/driver-profile', () => {
  let token;
  let userId;

  beforeEach(async () => {
    ({ token, userId } = await authenticate());
  });

  it('creates a driver profile with its vehicle', async () => {
    const response = await onboard(token);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Driver profile created successfully',
    });
    expect(response.body.data.driverProfile).toMatchObject({
      userId,
      status: 'OFFLINE',
    });
    expect(response.body.data.driverProfile.tesla).toMatchObject({
      driverId: response.body.data.driverProfile.id,
      plateNumber: 'DHK-1234',
      model: 'Model 3',
      seatCapacity: 4,
    });
  });

  it('persists the profile and the vehicle with the right links', async () => {
    const response = await onboard(token);
    const { id } = response.body.data.driverProfile;

    const storedProfile = await prisma.driverProfile.findUnique({ where: { id } });
    expect(storedProfile).not.toBeNull();
    expect(storedProfile.userId).toBe(userId);

    const storedTesla = await prisma.tesla.findFirst({ where: { driverId: id } });
    expect(storedTesla).not.toBeNull();
    expect(storedTesla.driverId).toBe(storedProfile.id);
    expect(storedTesla).toMatchObject({
      plateNumber: 'DHK-1234',
      model: 'Model 3',
      seatCapacity: 4,
    });

    // One profile and one vehicle, linked to each other and to the account.
    expect(await prisma.driverProfile.count()).toBe(1);
    expect(await prisma.tesla.count()).toBe(1);
  });

  it('returns DTO fields that match the persisted rows', async () => {
    const response = await onboard(token);
    const dto = response.body.data.driverProfile;

    const storedProfile = await prisma.driverProfile.findUnique({ where: { id: dto.id } });
    const storedTesla = await prisma.tesla.findFirst({ where: { driverId: dto.id } });

    expect(dto).toMatchObject({
      id: storedProfile.id,
      userId: storedProfile.userId,
      status: storedProfile.status,
    });
    expect(dto.tesla).toMatchObject({
      id: storedTesla.id,
      driverId: storedTesla.driverId,
      plateNumber: storedTesla.plateNumber,
      model: storedTesla.model,
      seatCapacity: storedTesla.seatCapacity,
    });
  });

  it('returns exactly the documented DTO fields', async () => {
    const response = await onboard(token);
    const dto = response.body.data.driverProfile;

    expect(Object.keys(dto).sort()).toEqual(
      ['id', 'userId', 'status', 'createdAt', 'updatedAt', 'tesla'].sort(),
    );
    expect(Object.keys(dto.tesla).sort()).toEqual(
      ['id', 'driverId', 'plateNumber', 'model', 'seatCapacity', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('takes userId from the token, not the body', async () => {
    const other = await authenticate({ email: 'other@example.com', name: 'Other Driver' });

    const response = await onboard(token, { ...vehicle, userId: other.userId });

    expect(response.status).toBe(201);
    expect(response.body.data.driverProfile.userId).toBe(userId);
    expect(response.body.data.driverProfile.userId).not.toBe(other.userId);

    const stored = await prisma.driverProfile.findUnique({
      where: { id: response.body.data.driverProfile.id },
    });
    expect(stored.userId).toBe(userId);
  });

  it('ignores a client-supplied driverId and status', async () => {
    const response = await onboard(token, {
      ...vehicle,
      driverId: 'a0000000-0000-4000-8000-000000000000',
      status: 'ONLINE',
    });

    expect(response.status).toBe(201);
    const dto = response.body.data.driverProfile;

    expect(dto.status).toBe('OFFLINE');
    expect(dto.tesla.driverId).toBe(dto.id);
    expect(dto.tesla.driverId).not.toBe('a0000000-0000-4000-8000-000000000000');

    const stored = await prisma.driverProfile.findUnique({ where: { id: dto.id } });
    expect(stored.status).toBe('OFFLINE');
  });

  it('does not let the body override any server-owned field', async () => {
    const response = await onboard(token, {
      ...vehicle,
      id: 'a0000000-0000-4000-8000-000000000000',
      userId: 'a0000000-0000-4000-8000-000000000000',
      driverId: 'a0000000-0000-4000-8000-000000000000',
      status: 'ONLINE',
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '1999-01-01T00:00:00.000Z',
    });

    expect(response.status).toBe(201);
    const dto = response.body.data.driverProfile;

    expect(dto.id).not.toBe('a0000000-0000-4000-8000-000000000000');
    expect(dto.userId).toBe(userId);
    expect(dto.status).toBe('OFFLINE');
    expect(dto.tesla.driverId).toBe(dto.id);
    expect(new Date(dto.createdAt).getUTCFullYear()).toBeGreaterThan(2020);
    expect(new Date(dto.updatedAt).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('never exposes the user record or a credential', async () => {
    const response = await onboard(token);

    expect(response.body.data.driverProfile).not.toHaveProperty('user');
    expect(response.body.data.driverProfile.tesla).not.toHaveProperty('user');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(driver.password);
  });

  it('rejects a passenger with 403', async () => {
    const passenger = await authenticate({
      name: 'Nusrat Jahan',
      email: 'nusrat@example.com',
      role: 'PASSENGER',
    });

    const response = await onboard(passenger.token);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).post('/api/driver-profile').send(vehicle);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a garbage token with 401', async () => {
    const response = await request(app)
      .post('/api/driver-profile')
      .set('Authorization', 'Bearer not.a.jwt')
      .send(vehicle);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it.each([
    ['a missing plate number', { model: 'Model 3', seatCapacity: 4 }],
    ['a blank plate number', { ...vehicle, plateNumber: '   ' }],
    ['a one-character plate number', { ...vehicle, plateNumber: 'D' }],
    ['an over-long plate number', { ...vehicle, plateNumber: 'x'.repeat(81) }],
    ['a missing model', { plateNumber: 'DHK-1234', seatCapacity: 4 }],
    ['a blank model', { ...vehicle, model: '  ' }],
    ['a one-character model', { ...vehicle, model: '3' }],
    ['an over-long model', { ...vehicle, model: 'x'.repeat(81) }],
    ['a missing seat capacity', { plateNumber: 'DHK-1234', model: 'Model 3' }],
    ['a fractional seat capacity', { ...vehicle, seatCapacity: 4.5 }],
    ['a non-numeric seat capacity', { ...vehicle, seatCapacity: 'four' }],
    ['a zero seat capacity', { ...vehicle, seatCapacity: 0 }],
    ['a negative seat capacity', { ...vehicle, seatCapacity: -2 }],
    ['an empty body', {}],
  ])('rejects %s with 400 and field errors', async (_label, payload) => {
    const response = await onboard(token, payload);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Validation failed',
    });
    expect(response.body.details.length).toBeGreaterThan(0);
    expect(response.body.details[0]).toHaveProperty('field');
  });

  it('upper-cases and trims the plate number', async () => {
    const response = await onboard(token, { ...vehicle, plateNumber: '  dhk-1234  ' });

    expect(response.status).toBe(201);
    expect(response.body.data.driverProfile.tesla.plateNumber).toBe('DHK-1234');

    const stored = await prisma.tesla.findFirst({ where: { driverId: response.body.data.driverProfile.id } });
    expect(stored.plateNumber).toBe('DHK-1234');
  });

  it('trims the vehicle model', async () => {
    const response = await onboard(token, { ...vehicle, model: '  Model 3  ' });

    expect(response.status).toBe(201);
    expect(response.body.data.driverProfile.tesla.model).toBe('Model 3');
  });

  it('rejects a second profile for the same driver with 409', async () => {
    const first = await onboard(token);
    expect(first.status).toBe(201);

    const response = await onboard(token, { ...vehicle, plateNumber: 'DHK-9999' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Driver profile already exists',
    });

    // The second attempt must not have replaced or added a vehicle.
    const teslas = await prisma.tesla.findMany();
    expect(teslas).toHaveLength(1);
    expect(teslas[0].plateNumber).toBe('DHK-1234');
  });

  it('creates exactly one profile and one vehicle per driver', async () => {
    await onboard(token);
    await onboard(token, { ...vehicle, plateNumber: 'DHK-9999' });

    expect(await prisma.driverProfile.count()).toBe(1);
    expect(await prisma.tesla.count()).toBe(1);
  });

  it('rejects a plate number another driver already owns and rolls back the profile', async () => {
    // A different driver from the one `beforeEach` registered, so this test
    // owns the plate rather than colliding on the profile check first.
    await createProfile({ email: 'owner@example.com', name: 'Plate Owner' });

    const intruder = await authenticate({
      name: 'Sabina Akter',
      email: 'sabina@example.com',
    });

    const response = await onboard(intruder.token, { ...vehicle, plateNumber: 'DHK-1234' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      message: 'A vehicle with this plate number already exists',
    });

    // The second driver's profile was created inside the transaction, so the
    // unique violation must have rolled it back rather than leaving a driver
    // who can never onboard.
    const profiles = await prisma.driverProfile.findMany();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].userId).not.toBe(intruder.userId);
    expect(await prisma.driverProfile.findUnique({ where: { userId: intruder.userId } })).toBeNull();

    const teslas = await prisma.tesla.findMany();
    expect(teslas).toHaveLength(1);
    expect(teslas[0].driverId).toBe(profiles[0].id);
  });

  it('lets exactly one of two concurrent onboardings succeed', async () => {
    const responses = await Promise.all([
      onboard(token, { ...vehicle, plateNumber: 'DHK-0001' }),
      onboard(token, { ...vehicle, plateNumber: 'DHK-0002' }),
    ]);

    // Ordering is not guaranteed, so compare the sorted statuses.
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    expect(await prisma.driverProfile.count()).toBe(1);
    expect(await prisma.tesla.count()).toBe(1);
  });

  it('rolls back the losing profile when two drivers race for one plate', async () => {
    const first = await authenticate({ name: 'First Driver', email: 'first@example.com' });
    const second = await authenticate({ name: 'Second Driver', email: 'second@example.com' });

    // Both pre-checks run before either transaction commits, so both pass and
    // the real collision happens on the unique index inside the transaction.
    // This is the only path that exercises the rollback: the loser must not be
    // left with a profile and no vehicle.
    const responses = await Promise.all([
      onboard(first.token, { ...vehicle, plateNumber: 'DHK-4242' }),
      onboard(second.token, { ...vehicle, plateNumber: 'DHK-4242' }),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    const failed = responses.find((response) => response.status === 409);
    expect(failed.body.message).toBe('A vehicle with this plate number already exists');

    // Exactly one of the two drivers is onboarded; the loser's profile and
    // Tesla were both rolled back together.
    const profiles = await prisma.driverProfile.findMany();
    expect(profiles).toHaveLength(1);
    expect(await prisma.tesla.count()).toBe(1);

    const winner = profiles[0];
    const loserId = winner.userId === first.userId ? second.userId : first.userId;
    expect(await prisma.driverProfile.findUnique({ where: { userId: loserId } })).toBeNull();
    expect(await prisma.tesla.findFirst({ where: { driverId: winner.id } })).not.toBeNull();
  });
});

describe('GET /api/driver-profile', () => {
  const read = (token) => request(app).get('/api/driver-profile').set('Authorization', `Bearer ${token}`);

  it('returns the caller profile with its vehicle', async () => {
    const { profile, userId, token } = await createProfile();

    const response = await read(token);

    expect(response.status).toBe(200);
    expect(response.body.data.driverProfile).toMatchObject({
      id: profile.id,
      userId,
      status: 'OFFLINE',
      tesla: { plateNumber: vehicle.plateNumber, seatCapacity: 4 },
    });
  });

  it('reports the availability the driver last set', async () => {
    const { token } = await createProfile();

    await request(app)
      .post('/api/availability')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ONLINE' });

    const response = await read(token);

    expect(response.body.data.driverProfile.status).toBe('ONLINE');
  });

  it('never exposes the account behind the profile', async () => {
    const { token } = await createProfile();

    const response = await read(token);
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('email');
    expect(response.body.data.driverProfile.user).toBeUndefined();
  });

  it('returns 404 before onboarding', async () => {
    const { token } = await authenticate();

    const response = await read(token);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Driver profile not found');
  });

  it('returns 403 for a passenger', async () => {
    const { body } = await request(app).post('/api/auth/register').send({
      name: 'Nusrat Jahan',
      email: 'nusrat@example.com',
      password: 'password123',
      role: 'PASSENGER',
    });

    const response = await read(body.data.token);

    expect(response.status).toBe(403);
  });

  it('returns 401 without a token and for a garbage token', async () => {
    expect((await request(app).get('/api/driver-profile')).status).toBe(401);
    expect(
      (await request(app).get('/api/driver-profile').set('Authorization', 'Bearer nope')).status,
    ).toBe(401);
  });
});
