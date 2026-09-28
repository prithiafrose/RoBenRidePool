import { AppError } from '../utils/AppError.js';

/**
 * Restricts a route to the given roles. Must be mounted after `authenticate`,
 * because it reads the identity that middleware attaches to the request.
 *
 *   router.post('/driver/availability', authenticate, requireRole('DRIVER'), handler)
 *
 * @param {...('PASSENGER'|'DRIVER')} allowedRoles
 */
export const requireRole =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(AppError.forbidden('You do not have permission to perform this action'));
    }

    return next();
  };
