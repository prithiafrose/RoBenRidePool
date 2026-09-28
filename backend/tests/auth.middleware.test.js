import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { authenticate } from '../src/middleware/auth.middleware.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { notFoundHandler } from '../src/middleware/notFound.middleware.js';
import { requireRole } from '../src/middleware/role.middleware.js';
import { TOKEN_EXPIRES_IN } from '../src/utils/jwt.js';

const app = createApp();

const account = {
  name: 'Alan Turing',
  email: 'alan@example.com',
  password: 'password123',
  role: 'PASSENGER',
};

const register = (payload = account) => request(app).post('/api/auth/register').send(payload);

const login = (payload) => request(app).post('/api/auth/login').send(payload);

/** Creates an account and returns the parsed registration body. */
const createAccount = async (overrides = {}) => {
  const response = await register({ ...account, ...overrides });
  return response.body.data;
};

describe('GET /api/auth/me', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await createAccount());
  });

  it('returns the authenticated profile', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Authenticated user',
    });
    expect(response.body.data.user).toMatchObject({
      id: expect.any(String),
      name: 'Alan Turing',
      email: 'alan@example.com',
      role: 'PASSENGER',
    });
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a request without a token', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Missing or malformed Authorization header');
  });

  it('rejects a malformed Authorization header', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', token);

    expect(response.status).toBe(401);
  });

  it.each([
    ['a garbage token', 'not-a-jwt'],
    ['a token signed with another secret', jwt.sign({ sub: '1', role: 'PASSENGER' }, 'other-secret')],
    ['a token with a tampered payload', `${'a'}.b.c`],
  ])('rejects %s', async (_label, invalidToken) => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${invalidToken}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid or expired token');
  });

  it('rejects an expired token', async () => {
    const expiredToken = jwt.sign(
      { sub: 'some-id', role: 'PASSENGER' },
      env.jwtSecret,
      { expiresIn: '-1s' },
    );

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid or expired token');
  });
});

describe('JWT token payload', () => {
  it('contains the user id and role, and expires in 1h', async () => {
    const { user, token } = await createAccount({ role: 'DRIVER' });
    const payload = jwt.verify(token, env.jwtSecret);

    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe('DRIVER');
    expect(payload).not.toHaveProperty('email');

    const lifetimeSeconds = payload.exp - payload.iat;
    expect(lifetimeSeconds).toBe(3600);
    expect(TOKEN_EXPIRES_IN).toBe('1h');
  });
});

describe('requireRole middleware', () => {
  /**
   * Assembles a minimal app that mounts the real router and the real 404 and
   * error handlers, plus two throwaway guarded routes. Registering them on the
   * production app is not an option, because `createApp` installs the 404
   * handler last and anything added afterwards would never be reached.
   */
  const createGuardedApp = () => {
    const guarded = express();
    const echoRole = (req, res) => res.json({ success: true, data: { role: req.user.role } });

    guarded.use(express.json());
    guarded.get('/test/passenger-only', authenticate, requireRole('PASSENGER'), echoRole);
    guarded.get('/test/driver-only', authenticate, requireRole('DRIVER'), echoRole);
    guarded.use(notFoundHandler);
    guarded.use(errorHandler);

    return guarded;
  };

  it('allows a passenger on a passenger-only route', async () => {
    const { token } = await createAccount();

    const response = await request(createGuardedApp())
      .get('/test/passenger-only')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('PASSENGER');
  });

  it('allows a driver on a driver-only route', async () => {
    const { token } = await createAccount({
      name: 'Marie Curie',
      email: 'marie@example.com',
      role: 'DRIVER',
    });

    const response = await request(createGuardedApp())
      .get('/test/driver-only')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('forbids a passenger on a driver-only route with 403', async () => {
    const { token } = await createAccount();

    const response = await request(createGuardedApp())
      .get('/test/driver-only')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You do not have permission to perform this action');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(createGuardedApp()).get('/test/driver-only');

    expect(response.status).toBe(401);
  });

  it('accepts a login token issued for a driver', async () => {
    const { user } = await createAccount({
      name: 'Marie Curie',
      email: 'marie@example.com',
      role: 'DRIVER',
    });

    const { body } = await login({ email: user.email, password: account.password });

    const response = await request(createGuardedApp())
      .get('/test/driver-only')
      .set('Authorization', `Bearer ${body.data.token}`);

    expect(response.status).toBe(200);
  });

  it('allows a role that is listed together with another', async () => {
    const { token } = await createAccount();

    const guarded = express();
    guarded.get(
      '/test/either',
      authenticate,
      requireRole('PASSENGER', 'DRIVER'),
      (req, res) => res.json({ success: true, data: { role: req.user.role } }),
    );

    const response = await request(guarded)
      .get('/test/either')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });
});
