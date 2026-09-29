import { z } from 'zod';

/** Predefined Dhaka area, for example "Dhanmondi", "Gulshan", "Banani". */
const area = (label) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(80, `${label} must be at most 80 characters`);

const latitude = (label) =>
  z
    .number({ error: `${label} must be a number` })
    .min(-90, `${label} must be between -90 and 90`)
    .max(90, `${label} must be between -90 and 90`);

const longitude = (label) =>
  z
    .number({ error: `${label} must be a number` })
    .min(-180, `${label} must be between -180 and 180`)
    .max(180, `${label} must be between -180 and 180`);

/**
 * Coordinates are drawn or used to estimate distance, so a half pair would
 * plot at (0, 0). Rejecting the partial form here is cheaper than repairing it
 * in the service layer.
 */
const latLngPair = (data, ctx) => {
  const pairs = [
    ['pickupLat', 'pickupLng'],
    ['destinationLat', 'destinationLng'],
  ];

  for (const [latKey, lngKey] of pairs) {
    const hasLat = data[latKey] !== undefined;
    const hasLng = data[lngKey] !== undefined;

    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: 'custom',
        path: [hasLat ? lngKey : latKey],
        message: `${hasLat ? lngKey : latKey} is required when ${
          hasLat ? latKey : lngKey
        } is provided`,
      });
    }
  }

  return z.NEVER;
};

/**
 * `passengerId` and `status` are intentionally absent: the first comes from the
 * access token and the second is left to the Prisma default, so neither is
 * client-controlled. `estimatedFarePaisa` is missing because the service prices
 * the ride. The schema stays non-strict on purpose, matching `auth.validator.js`:
 * `validateBody` strips unknown keys, so a client that sends `estimatedFarePaisa`
 * gets the server value instead of a 400.
 */
export const createRideRequestSchema = z
  .object({
    pickupArea: area('Pickup area'),
    destinationArea: area('Destination area'),
    // The upper bound keeps the server-side fare estimate inside the 32-bit
    // range of `estimatedFarePaisa`, which would otherwise overflow INT4 and
    // surface as a 500 rather than a validation error.
    seatsRequested: z
      .number({ error: 'Seats requested is required' })
      .int('Seats requested must be a whole number')
      .min(1, 'Seats requested must be at least 1')
      .max(10, 'Seats requested must be at most 10'),
    pickupLat: latitude('Pickup latitude').optional(),
    pickupLng: longitude('Pickup longitude').optional(),
    destinationLat: latitude('Destination latitude').optional(),
    destinationLng: longitude('Destination longitude').optional(),
  })
  .superRefine(latLngPair);

/**
 * Path parameter of `GET /api/ride-requests/:id`.
 *
 * `id` is a Prisma `@default(uuid())` primary key, so a value that is not a
 * UUID can never match a row. Rejecting it here turns a client typo into a 400
 * with a field-level message, instead of a 404 that is indistinguishable from a
 * legitimately deleted request.
 */
export const rideRequestIdParamSchema = z.object({
  id: z.uuid('Ride request id must be a valid UUID'),
});
