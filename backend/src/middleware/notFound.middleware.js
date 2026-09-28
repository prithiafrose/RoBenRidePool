import { AppError } from '../utils/AppError.js';

/**
 * Terminal middleware for unknown routes. Registered after all routers,
 * so anything still unmatched ends up here.
 */
export const notFoundHandler = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};
