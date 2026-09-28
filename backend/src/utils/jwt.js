import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';

/**
 * Access tokens are short lived: the MVP has no refresh token, so a leaked
 * token expires within the hour.
 */
export const TOKEN_EXPIRES_IN = '1h';

/**
 * Signs an access token. Only the user id and role are included, so a
 * permission change does not require the role to travel with every request.
 */
export const signAccessToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: TOKEN_EXPIRES_IN,
  });

/**
 * Verifies a token. Throws a `TokenExpiredError` or `JsonWebTokenError` when
 * the token is invalid, malformed or expired; the auth middleware translates
 * both into a 401.
 */
export const verifyAccessToken = (token) => jwt.verify(token, env.jwtSecret);
