import { AppError } from '../utils/AppError.js';
import { verifyAccessToken } from '../utils/jwt.js';

/**
 * Requires a valid `Authorization: Bearer <token>` header and exposes the
 * authenticated identity as `req.user = { id, role }`.
 *
 * All three failure modes (missing, invalid, expired) return the same 401
 * response, and the token is never logged.
 */
export const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(AppError.unauthorized('Invalid or expired token'));
  }
};
