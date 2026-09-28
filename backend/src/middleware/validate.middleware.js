import { AppError } from '../utils/AppError.js';

/** Flattens Zod issues into `[{ field, message }]` for the API response. */
const toFieldErrors = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));

/**
 * Validates `req.body` against a Zod schema and replaces it with the parsed
 * result, so controllers receive trimmed/typed data. Unknown keys are
 * stripped, which prevents mass-assignment of fields like `passwordHash`.
 */
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    return next(AppError.badRequest('Validation failed', toFieldErrors(result.error)));
  }

  req.body = result.data;
  return next();
};
