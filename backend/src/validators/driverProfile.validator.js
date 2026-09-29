import { z } from 'zod';

/**
 * Registration plate. Normalised to upper case so the unique index on
 * `teslas.plateNumber` is effectively case-insensitive, matching how
 * `auth.service.js` lower-cases emails before a uniqueness check. The `.pipe()`
 * is required because Zod runs format checks before transforms on the same
 * field, so the length limits must be applied after the transform.
 */
const plateNumber = z
  .string({ error: 'Plate number is required' })
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2, 'Plate number must be at least 2 characters')
      .max(80, 'Plate number must be at most 80 characters'),
  );

const vehicleModel = z
  .string({ error: 'Model is required' })
  .trim()
  .min(2, 'Model must be at least 2 characters')
  .max(80, 'Model must be at most 80 characters');

/**
 * Body of `POST /api/driver-profile`.
 *
 * `userId`, `driverId`, `status` and the generated ids/timestamps are
 * intentionally absent: the first two are taken from the access token and from
 * the newly created profile, and `status` is left to the Prisma default of
 * `OFFLINE`, so none of them can be set by a client. The schema stays
 * non-strict on purpose, matching `auth.validator.js` and
 * `rideRequest.validator.js`: `validateBody` strips unknown keys, so a client
 * that sends `status` gets the server value instead of a 400.
 *
 * `seatCapacity` has no maximum: the schema records no vehicle larger than any
 * other, and the limit that matters is enforced per pool against this value.
 */
export const createDriverProfileSchema = z.object({
  plateNumber,
  model: vehicleModel,
  // The count includes the driver's own seat, per the schema comment on
  // `Tesla.seatCapacity`, so 1 is the smallest meaningful value.
  seatCapacity: z
    .number({ error: 'Seat capacity is required' })
    .int('Seat capacity must be a whole number')
    .min(1, 'Seat capacity must be at least 1'),
});
