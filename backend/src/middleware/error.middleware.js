import { isProduction } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * Centralized error handler. Express 5 forwards rejected promises from
 * async handlers here, so no wrapper is needed at the call sites.
 *
 * Signature must keep the 4 parameters for Express to recognise it.
 */
export const errorHandler = (err, req, res, next) => {
  const isOperational = err instanceof AppError || err.isOperational === true;
  const statusCode = isOperational ? err.statusCode : 500;

  // Expected failures (404, validation...) are logged on one line. Unexpected
  // ones get the full stack so they can actually be debugged.
  if (isOperational) {
    console.warn(`[warn] ${req.method} ${req.originalUrl} -> ${statusCode} ${err.message}`);
  } else {
    console.error(`[error] ${req.method} ${req.originalUrl} ->`, err);
  }

  res.status(statusCode).json({
    success: false,
    message: isOperational || !isProduction ? err.message : 'Internal server error',
    ...(isOperational && err.details ? { details: err.details } : {}),
    ...(!isProduction ? { stack: err.stack } : {}),
  });
};
