import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const app = createApp();

const passenger = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'password123',
  role: 'PASSENGER',
};

/** Registers a user through the API and returns the response body. */
const register = (payload = passenger) => request(app).post('/api/auth/register').send(payload);

const login = (payload) => request(app).post('/api/auth/login').send(payload);

describe('POST /api/auth/register', () => {
  it('creates a passenger account', async () => {
    const response = await register();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Account created successfully',
    });
    expect(response.body.data.user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'PASSENGER',
    });
    expect(response.body.data.token).toEqual(expect.any(String));
  });

  it('creates a driver account', async () => {
    const response = await register({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'password123',
      role: 'DRIVER',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe('DRIVER');
  });

  it('never returns the password hash', async () => {
    const response = await register();

    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(passenger.password);
  });

  it('stores the password as a bcrypt hash', async () => {
    const { prisma } = await import('../src/config/prisma.js');
    await register();

    const stored = await prisma.user.findUnique({ where: { email: passenger.email } });

    expect(stored.passwordHash).not.toBe(passenger.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('normalizes the email before storing it', async () => {
    const { prisma } = await import('../src/config/prisma.js');
    await register({ ...passenger, email: '  Ada@Example.COM ' });

    const stored = await prisma.user.findUnique({ where: { email: 'ada@example.com' } });

    expect(stored).not.toBeNull();
  });

  it('rejects a duplicate email with 409', async () => {
    await register();

    const response = await register({ ...passenger, name: 'Someone Else' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      message: 'An account with this email already exists',
    });
  });

  it('treats a differently cased duplicate email as the same account', async () => {
    await register();

    const response = await register({ ...passenger, email: 'ADA@EXAMPLE.COM' });

    expect(response.status).toBe(409);
  });

  it.each([
    ['an unsupported role', { ...passenger, role: 'ADMIN' }],
    ['a missing role', { name: 'Ada', email: 'ada@example.com', password: 'password123' }],
    ['a short password', { ...passenger, password: 'abc1' }],
    ['a password without a number', { ...passenger, password: 'passwordonly' }],
    ['a malformed email', { ...passenger, email: 'not-an-email' }],
    ['a missing name', { email: 'ada@example.com', password: 'password123', role: 'PASSENGER' }],
    ['an empty body', {}],
  ])('rejects %s with 400 and field errors', async (_label, payload) => {
    const response = await register(payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details.length).toBeGreaterThan(0);
    expect(response.body.details[0]).toHaveProperty('field');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('returns a token for valid credentials', async () => {
    const response = await login({ email: passenger.email, password: passenger.password });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Logged in successfully',
    });
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.user.email).toBe(passenger.email);
  });

  it('accepts a differently cased email', async () => {
    const response = await login({ email: 'ADA@example.com', password: passenger.password });

    expect(response.status).toBe(200);
  });

  it('rejects a wrong password with a generic 401', async () => {
    const response = await login({ email: passenger.email, password: 'wrongpassword1' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Invalid email or password',
    });
  });

  it('rejects an unknown email with the same generic message', async () => {
    const response = await login({ email: 'nobody@example.com', password: passenger.password });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid email or password');
  });

  it('never returns the password hash', async () => {
    const response = await login({ email: passenger.email, password: passenger.password });

    expect(response.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a request without a password with 400', async () => {
    const response = await login({ email: passenger.email });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });
});
