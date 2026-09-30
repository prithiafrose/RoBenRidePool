/**
 * Display formatting shared by both dashboards.
 *
 * Everything here is presentation only. No value that reaches the API is
 * formatted or rounded on the way out - paisa are sent as whole numbers and
 * instants as the ISO strings the API documents, and only turned into something
 * readable for a human on the way to the screen.
 */

/**
 * Paisa to Bangladeshi Taka.
 *
 * The API stores money as an integer count of paisa, so 125000 is Tk 1,250.00
 * and never a float: dividing into taka has to happen once, here, rather than in
 * each component. `null` is rendered as a dash because a ride that has not
 * settled yet has no fare, and showing "Tk 0.00" for that would be a lie.
 */
export const formatPaisa = (paisa) => {
  if (paisa === null || paisa === undefined) return "—";

  const sign = paisa < 0 ? "-" : "";
  const absolute = Math.abs(paisa);
  const taka = Math.trunc(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");

  return `${sign}Tk ${taka.toLocaleString("en-US")}.${remainder}`;
};

/**
 * A departure window as one line, in the reader's own timezone.
 *
 * The API's rule is an explicit offset so the value is never ambiguous, but an
 * instant with no offset at all is a well-formed ISO string, so `toISOString()`
 * would render `...T02:00:00.000Z` - correct and unreadable. Rendering in the
 * viewer's local zone instead means the same request reads sensibly in Dhaka and
 * in Berlin without the client having to know which city the writer was in.
 */
export const formatWindow = (from, to) => {
  if (!from || !to) return "—";

  return `${formatDateTime(from)} → ${formatDateTime(to)}`;
};

/** One instant, in the viewer's local timezone. */
export const formatDateTime = (value) => {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** A duration in minutes, as a short phrase. */
export const formatDuration = (minutes) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";

  if (minutes < 60) return `${Math.round(minutes)} min`;

  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

/**
 * How long is a departure window, in minutes, measured between the two instants.
 *
 * Used by the forms to preview the window the driver or passenger typed before
 * it is sent, so an obviously wrong range is visible while it is still editable
 * rather than as a 400 afterwards.
 */
export const windowLengthMinutes = (from, to) => {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return (end - start) / 60000;
};

/**
 * Turns an instant from a `datetime-local` input into the ISO string the API
 * requires.
 *
 * Two conversions matter here, and the second is easy to miss. A `datetime-local`
 * input yields a naive local string like `2026-10-01T08:00`, which the API
 * rejects on purpose: it states no offset, and the column it lands in cannot
 * store one. So the value is first read as local time by `new Date(...)`, then
 * written back out as UTC with `toISOString()`, which ends in `Z` - an explicit
 * offset that means the same instant the input showed.
 */
export const toApiInstant = (localValue) => {
  if (!localValue) return null;

  const date = new Date(localValue);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Human label for a ride request status. */
export const REQUEST_STATUS_LABELS = {
  WAITING: "Waiting for a driver",
  MATCHED: "Driver found",
  IN_PROGRESS: "On the way",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Human label for a pool status. Mirrors the Prisma `PoolStatus` enum. */
export const POOL_STATUS_LABELS = {
  OPEN: "Open for passengers",
  IN_PROGRESS: "On the road",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Human label for a driver's availability. */
export const AVAILABILITY_LABELS = {
  ONLINE: "Online",
  OFFLINE: "Offline",
};

/**
 * Tailwind classes per status, used by `StatusBadge`.
 *
 * Kept as one map rather than a class inside each status string so a status
 * cannot be added to a label list without also being given a colour - the two
 * would otherwise drift.
 */
export const STATUS_TONES = {
  WAITING: "bg-amber-100 text-amber-800",
  MATCHED: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-600",
  OPEN: "bg-sky-100 text-sky-800",
  ONLINE: "bg-emerald-100 text-emerald-800",
  OFFLINE: "bg-slate-200 text-slate-600",
};