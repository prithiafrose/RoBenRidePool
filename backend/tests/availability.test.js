import request from 'supertest';
import { describe, expect, it } from 'vitest';

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

/** Registers an account and returns the token plus the user id. */
const authenticate = async (overrides = {}) => {
  const { body } = await request(app).post('/api/auth/register').send({
    ...driverAccount,
    ...overrides,
  });

  return { token: body.data.token, userId: body.data.user.id };
};

/**
 * Returns a fully onboarded driver: a token, their `userId`, their
 * `DriverProfile` id and their `Tesla` id. Pass `payload` to onboard a second
 * driver on a different plate, since the default one is already taken.
 */
const onboardedDriver = async (overrides = {}, payload = vehicle) => {
  const { token, userId } = await authenticate(overrides);

  const { body: onboarded } = await request(app)
    .post('/api/driver-profile')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  return {
    token,
    userId,
    driverProfileId: onboarded.data.driverProfile.id,
    teslaId: onboarded.data.driverProfile.tesla.id,
  };
};

const setAvailability = (token, payload) =>
  request(app).post('/api/availability').set('Authorization', `Bearer ${token}`).send(payload);

describe('POST /api/availability', () => {
  it('takes a driver offline', async () => {
    const { token, driverProfileId } = await onboardedDriver();

    const response = await setAvailability(token, { status: 'OFFLINE' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Driver availability updated successfully',
    });
    expect(response.body.data.driverProfile).toMatchObject({
      id: driverProfileId,
      status: 'OFFLINE',
    });
  });

  it('takes a driver online', async () => {
    const { token, driverProfileId } = await onboardedDriver();

    const response = await setAvailability(token, { status: 'ONLINE' });

    expect(response.status).toBe(200);
    expect(response.body.data.driverProfile).toMatchObject({
      id: driverProfileId,
      status: 'ONLINE',
    });

    const stored = await prisma.driverProfile.findUnique({ where: { id: driverProfileId } });

    expect(stored.status).toBe('ONLINE');
  });

  it('persists the new status so a later read sees it', async () => {
    const { token, driverProfileId } = await onboardedDriver();

    await setAvailability(token, { status: 'ONLINE' });

    // Read through a second call rather than through Prisma, so this also proves
    // the endpoint reports the stored state instead of echoing the request.
    const again = await setAvailability(token, { status: 'OFFLINE' });

    expect(again.body.data.driverProfile.status).toBe('OFFLINE');

    const stored = await prisma.driverProfile.findUnique({ where: { id: driverProfileId } });

    expect(stored.status).toBe('OFFLINE');
  });

  it('is idempotent when the driver repeats the same status', async () => {
    const { token, driverProfileId } = await onboardedDriver();

    await setAvailability(token, { status: 'ONLINE' });
    const repeat = await setAvailability(token, { status: 'ONLINE' });

    expect(repeat.status).toBe(200);
    expect(repeat.body.data.driverProfile.status).toBe('ONLINE');
    expect(
      (await prisma.driverProfile.findUnique({ where: { id: driverProfileId } })).status,
    ).toBe('ONLINE');
  });

  it('returns the safe driver profile DTO with the Tesla attached', async () => {
    const { token, driverProfileId, teslaId, userId } = await onboardedDriver();

    const response = await setAvailability(token, { status: 'ONLINE' });
    const { driverProfile } = response.body.data;

    expect(Object.keys(driverProfile).sort()).toEqual([
      'createdAt',
      'id',
      'status',
      'tesla',
      'updatedAt',
      'userId',
    ]);
    expect(driverProfile).toMatchObject({
      id: driverProfileId,
      userId,
      status: 'ONLINE',
    });

    // The Tesla is included because the client needs its id to create a pool.
    expect(driverProfile.tesla).toMatchObject({ id: teslaId });

    // The `user` relation is never selected, so the account record stays out.
    expect(driverProfile).not.toHaveProperty('user');

    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(driverAccount.password);
  });

  it('does not change any other field on the profile', async () => {
    const { token, driverProfileId, teslaId, userId } = await onboardedDriver();
    const before = await prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { tesla: true },
    });

    await setAvailability(token, { status: 'ONLINE' });

    const after = await prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { tesla: true },
    });

    expect(after.userId).toBe(userId);
    expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect(after.tesla.id).toBe(teslaId);
    expect(after.tesla.plateNumber).toBe(before.tesla.plateNumber);
  });
});

describe('POST /api/availability onboarding rules', () => {
  it('leaves a newly onboarded driver offline', async () => {
    const { driverProfileId } = await onboardedDriver();

    const stored = await prisma.driverProfile.findUnique({ where: { id: driverProfileId } });

    expect(stored.status).toBe('OFFLINE');
  });

  it('returns 404 for a driver who has not onboarded', async () => {
    const { token } = await authenticate({ email: 'newdriver@example.com' });

    const response = await setAvailability(token, { status: 'ONLINE' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, message: 'Driver profile not found' });
  });

  it('still cannot set a status through the onboarding endpoint', async () => {
    const { token, userId } = await authenticate({ email: 'sneaky@example.com' });

    const response = await request(app)
      .post('/api/driver-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...vehicle, plateNumber: 'DHK-8888', status: 'ONLINE' });

    expect(response.status).toBe(201);

    // The client named a status, and the server kept its own OFFLINE default.
    expect(response.body.data.driverProfile.status).toBe('OFFLINE');

    const stored = await prisma.driverProfile.findUnique({ where: { userId } });

    expect(stored.status).toBe('OFFLINE');
  });
});

describe('POST /api/availability ownership', () => {
  it('never changes another driver', async () => {
    const first = await onboardedDriver();
    const second = await onboardedDriver(
      { name: 'Other Driver', email: 'other@example.com' },
      { ...vehicle, plateNumber: 'DHK-9999' },
    );

    const response = await setAvailability(second.token, { status: 'ONLINE' });

    expect(response.status).toBe(200);
    expect(response.body.data.driverProfile.id).toBe(second.driverProfileId);

    const firstStored = await prisma.driverProfile.findUnique({
      where: { id: first.driverProfileId },
    });
    const secondStored = await prisma.driverProfile.findUnique({
      where: { id: second.driverProfileId },
    });

    expect(firstStored.status).toBe('OFFLINE');
    expect(secondStored.status).toBe('ONLINE');
  });

  it('ignores a forged userId and driverId in the request body', async () => {
    const victim = await onboardedDriver();
    const attacker = await authenticate({ email: 'attacker@example.com', role: 'DRIVER' });

    const response = await setAvailability(attacker.token, {
      status: 'ONLINE',
      userId: victim.userId,
      driverId: victim.driverProfileId,
      id: victim.driverProfileId,
    });

    // The attacker has no profile, so this proves the named ids are not used to
    // choose a row: the lookup came from the token and found nothing.
    expect(response.status).toBe(404);

    const victimStored = await prisma.driverProfile.findUnique({
      where: { id: victim.driverProfileId },
    });

    expect(victimStored.status).toBe('OFFLINE');
  });

  it('ignores forged ids when the attacker does have a profile', async () => {
    const victim = await onboardedDriver();
    const attacker = await onboardedDriver(
      { name: 'Attacker', email: 'attacker@example.com' },
      { ...vehicle, plateNumber: 'DHK-5555' },
    );

    const response = await setAvailability(attacker.token, {
      status: 'ONLINE',
      userId: victim.userId,
      driverId: victim.driverProfileId,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.driverProfile.id).toBe(attacker.driverProfileId);

    const victimStored = await prisma.driverProfile.findUnique({
      where: { id: victim.driverProfileId },
    });
    const attackerStored = await prisma.driverProfile.findUnique({
      where: { id: attacker.driverProfileId },
    });

    // Only the authenticated driver's row moved.
    expect(victimStored.status).toBe('OFFLINE');
    expect(attackerStored.status).toBe('ONLINE');
  });
});

describe('POST /api/availability authorization', () => {
  it('requires authentication', async () => {
    const response = await request(app).post('/api/availability').send({ status: 'ONLINE' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app)
      .post('/api/availability')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ status: 'ONLINE' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a passenger', async () => {
    const { token } = await authenticate({
      name: 'Nusrat Jahan',
      email: 'nusrat@example.com',
      role: 'PASSENGER',
    });

    const response = await setAvailability(token, { status: 'ONLINE' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
    expect(await prisma.driverProfile.count()).toBe(0);
  });
});

describe('POST /api/availability validation', () => {
  it.each([
    ['a value outside the enum', 'BUSY', 'Status must be ONLINE or OFFLINE'],
    ['a lowercase value', 'online', 'Status must be ONLINE or OFFLINE'],
    ['a boolean', true, 'Status must be ONLINE or OFFLINE'],
    ['null', null, 'Status must be ONLINE or OFFLINE'],
  ])('rejects %s as a status', async (_label, status, message) => {
    const { token } = await onboardedDriver();

    const response = await setAvailability(token, { status });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details.map((issue) => issue.message)).toContain(message);

    const stored = await prisma.driverProfile.findFirst();

    expect(stored.status).toBe('OFFLINE');
  });

  it('rejects a missing status', async () => {
    const { token } = await onboardedDriver();

    const response = await setAvailability(token, {});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.details.map((issue) => issue.field)).toContain('status');
    expect((await prisma.driverProfile.findFirst()).status).toBe('OFFLINE');
  });

  it('rejects an empty body', async () => {
    const { token } = await onboardedDriver();

    const response = await setAvailability(token);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect((await prisma.driverProfile.findFirst()).status).toBe('OFFLINE');
  });
});