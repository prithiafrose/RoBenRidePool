import { z } from 'zod';

import { DriverStatus } from '@prisma/client';

/**
 * Body of `POST /api/availability`.
 *
 * `DriverStatus` comes from the Prisma schema, so the API and the database can
 * never drift apart, exactly as `auth.validator.js` does with `Role`.
 *
 * `userId` and `driverId` are absent on purpose: the profile is resolved from the
 * access token in the service, so neither can be set by a client. `createdAt` and
 * `updatedAt` are the database's to set.
 *
 * The object stays non-strict, matching every other schema in the project:
 * `validateBody` strips unknown keys, so a client that sends `userId` gets the
 * server value instead of a 400.
 *
 * The status is an explicit value rather than a toggle. A toggle is not
 * idempotent, so a retry after a network timeout would flip the driver's
 * availability the wrong way; naming the target state instead makes the call
 * safe to repeat.
 */
export const setAvailabilitySchema = z.object({
  status: z.enum(DriverStatus, { error: 'Status must be ONLINE or OFFLINE' }),
});