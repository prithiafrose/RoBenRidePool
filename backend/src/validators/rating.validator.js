import { z } from 'zod';

/**
 * Body of `POST /api/ratings`.
 *
 * Only the two values the client is allowed to name appear here. `raterId` and
 * `rateeId` are absent on purpose: the first comes from the access token and the
 * second is resolved in the service from the pool and the caller's relationship
 * to it, so neither can be forged. `createdAt` and `updatedAt` are the database's
 * to set.
 *
 * The object stays non-strict, matching `rideRequest.validator.js`: `validateBody`
 * strips unknown keys, so a client that sends `raterId` gets the server value
 * instead of a 400.
 *
 * `score` is a `number` and not a coerced string, so `"3"` is a 400 rather than
 * being quietly read as 3. `.int()` then rejects `3.5`, which keeps the stored
 * value a whole number and matches the `Int` column.
 */
export const createRatingSchema = z.object({
  poolId: z.uuid('Pool id must be a valid UUID'),
  score: z
    .number({ error: 'Score is required' })
    .int('Score must be a whole number')
    .min(1, 'Score must be at least 1')
    .max(5, 'Score must be at most 5'),
});