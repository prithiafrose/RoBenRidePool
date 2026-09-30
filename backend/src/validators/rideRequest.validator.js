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
 * A departure instant, as ISO 8601 with an explicit offset.
 *
 * `offset: true` is what makes the offset mandatory: without it Zod accepts
 * `Z` only, and with it a numeric offset such as `+06:00` is accepted as well.
 * A naive `2026-10-01T08:00:00` is rejected in every case, because the column is
 * `TIMESTAMP(3)` without time zone, so a value whose offset was never stated
 * cannot be stored without losing the information needed to interpret it. Making
 * the client state the offset is what lets the server store a UTC instant
 * without assuming any city's timezone.
 *
 * No `z.coerce.date()`: the value stays a string, so a number or a Date-like
 * object is a 400 rather than a silent conversion. That follows the same
 * no-coercion rule `rating.validator.js` states for `score`.
 */
const departureInstant = (field) =>
  z
    .string({ error: `${field} must be a string` })
    .pipe(z.iso.datetime({ offset: true, error: `${field} must be an ISO 8601 datetime with an explicit offset, for example 2026-10-01T08:00:00+06:00 or 2026-10-01T02:00:00Z` }));

/**
 * Cross-field rules for the departure window.
 *
 * `departureFrom < departureTo` is what makes the pair a window rather than two
 * unrelated instants, so equal bounds are rejected as well as inverted ones.
 *
 * A window that has already started cannot be served, so `departureFrom` must be
 * in the future. That rule is on the start of the window, not on whether the
 * window is still open: a window that began an hour ago is refused even when
 * `departureTo` is still ahead, because a request is made for a departure that
 * has not happened yet. `departureTo` is deliberately not compared against the
 * clock, so how far ahead the window runs is unconstrained -- there is no
 * documented minimum or maximum duration, no horizon on how far ahead a request
 * may be made, and no same-day restriction, so none is imposed here.
 *
 * Both comparisons parse to a timestamp and compare numbers. A field that failed
 * its own format check produces `NaN` here, every comparison against `NaN` is
 * false, and the invalid value is reported once by its own rule instead of twice
 * with a misleading message.
 */
const departureWindow = (data, ctx) => {
  const from = Date.parse(data.departureFrom);
  const to = Date.parse(data.departureTo);

  if (Number.isFinite(from) && Number.isFinite(to) && from >= to) {
    ctx.addIssue({
      code: 'custom',
      path: ['departureTo'],
      message: 'departureTo must be later than departureFrom',
    });
  }

  if (Number.isFinite(from) && from < Date.now()) {
    ctx.addIssue({
      code: 'custom',
      path: ['departureFrom'],
      message: 'departureFrom must not be in the past',
    });
  }
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
    departureFrom: departureInstant('departureFrom'),
    departureTo: departureInstant('departureTo'),
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
  .superRefine(latLngPair)
  .superRefine(departureWindow);

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
