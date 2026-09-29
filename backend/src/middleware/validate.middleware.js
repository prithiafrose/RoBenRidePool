import { AppError } from '../utils/AppError.js';

/**
 * Flattens Zod issues into `[{ field, message }]` for the API response.
 * `fallbackField` labels an issue with an empty path, so a whole-body failure
 * reads as `body` and a whole-params failure as `params`.
 */
export const toFieldErrors = (error, fallbackField = 'body') =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || fallbackField,
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

/**
 * Validates `req.params` against a Zod schema and replaces it with the parsed
 * result, mirroring `validateBody`. Used for route parameters such as `:id`,
 * so a malformed id is reported as a 400 with field-level details instead of
 * reaching the database and turning into an unhelpful 404 or 500.
 *
 *   router.get('/:id', authenticate, requireRole('PASSENGER'), validateParams(idSchema), getById);
 */
export const validateParams = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.params);

  if (!result.success) {
    return next(
      AppError.badRequest('Validation failed', toFieldErrors(result.error, 'params')),
    );
  }

  req.params = result.data;
  return next();
};
