/**
 * Response shape shared by every successful endpoint.
 * Controllers stay free of transport details by returning plain data.
 * The failure envelope is defined in `middleware/error.middleware.js`.
 */
export const sendSuccess = (res, data, statusCode = 200, message) =>
  res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    data,
  });
