import { z } from 'zod';

/**
 * The departure-window rules, shared by every endpoint that accepts a pair of
 * departure instants.
 *
 * They live here rather than in `rideRequest.validator.js` because two models now
 * carry the pair - `RideRequest` and `Pool` - and a driver opening a pool and a
 * passenger requesting a ride must be held to *exactly* the same standard. Two
 * copies of these rules would be free to drift, and a pool that accepted a naive
 * timestamp while requests rejected one would put an uninterpretable instant into
 * the column the matching rule compares against.
 */

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
export const departureInstant = (field) =>
  z
    .string({ error: `${field} must be a string` })
    .pipe(z.iso.datetime({ offset: true, error: `${field} must be an ISO 8601 datetime with an explicit offset, for example 2026-10-01T08:00:00+06:00 or 2026-10-01T02:00:00Z` }));

/**
 * Cross-field rules for a departure window.
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
 *
 * This validates the window on its own terms only. Whether one window is
 * *compatible* with another is a business rule about two existing rows, so it
 * belongs in the service layer where the comparison happens; see
 * `windowsOverlap` in `pool.service.js`.
 */
export const departureWindow = (data, ctx) => {
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