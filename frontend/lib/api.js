/**
 * Thin client for the RoBen RidePool REST API.
 * NEXT_PUBLIC_API_URL is inlined at build time, so it must be prefixed with
 * NEXT_PUBLIC_ to be visible in the browser.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

const REQUEST_TIMEOUT_MS = 10000;

/**
 * Error carrying the API's failure envelope, so the UI can show the server
 * message (for example "Invalid email or password") instead of a status code.
 */
export class ApiError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details ?? [];
  }

  /** Field messages keyed by field name, for inline form errors. */
  get fieldErrors() {
    return this.details.reduce((acc, { field, message }) => {
      acc[field] = message;
      return acc;
    }, {});
  }
}

const request = async (path, options = {}) => {
  let response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: options.body
        ? { "Content-Type": "application/json", ...options.headers }
        : options.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network failure, timeout, or CORS rejection.
    throw new ApiError("Could not reach the API. Is the backend running?", {
      status: 0,
    });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(payload?.message ?? "Something went wrong", {
      status: response.status,
      details: payload?.details,
    });
  }

  return payload.data;
};

/** Health probe used by the dashboard status card. */
export const getApiHealth = () => request("/api/health");

/** POST /api/auth/register */
export const registerRequest = (payload) =>
  request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });

/** POST /api/auth/login */
export const loginRequest = (payload) =>
  request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });

/** GET /api/auth/me - requires an access token. */
export const getCurrentUser = (token) =>
  request("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

/**
 * The bearer header, built in one place.
 *
 * Every endpoint below needs the caller's identity, and the dashboards send it
 * from a token that lives in `localStorage` - never a `userId` in a path or a
 * body. Keeping this here means no caller can accidentally send an id instead.
 */
const auth = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * A call that sends a JSON body.
 *
 * Used only where the endpoint takes values. Lifecycle transitions and declines
 * take none, and are issued without a body at all - which the API handles as
 * "no body" rather than as malformed.
 */
const send = (path, token, method, payload) =>
  request(path, {
    method,
    body: JSON.stringify(payload),
    headers: { ...auth(token), "Content-Type": "application/json" },
  });

/* ---------------------------------------------------------------- driver --- */

/** GET /api/driver-profile - 404 until the driver has onboarded. */
export const getDriverProfile = (token) =>
  request("/api/driver-profile", { headers: auth(token) });

/** POST /api/driver-profile - onboards with the one Tesla the driver will use. */
export const createDriverProfile = (token, payload) =>
  send("/api/driver-profile", token, "POST", payload);

/** POST /api/availability - names the target state, so a retry is safe. */
export const setAvailability = (token, status) =>
  send("/api/availability", token, "POST", { status });

/* ----------------------------------------------------------------- pools --- */

/** GET /api/pools - the driver's own pools, newest first. */
export const listPools = (token) => request("/api/pools", { headers: auth(token) });

/** POST /api/pools - the departure window is the only value a driver supplies. */
export const createPool = (token, payload) => send("/api/pools", token, "POST", payload);

/** GET /api/pools/:poolId - one pool with its members and their requests. */
export const getPool = (token, poolId) =>
  request(`/api/pools/${poolId}`, { headers: auth(token) });

/**
 * POST /api/pools/:poolId/members - accepting a ride.
 *
 * Only `rideRequestId` is sent. `seats` and `farePaisa` are derived by the API
 * from the ride request, so the client has no business naming them.
 */
export const acceptRideRequest = (token, poolId, rideRequestId) =>
  send(`/api/pools/${poolId}/members`, token, "POST", { rideRequestId });

/** PATCH /api/pools/:poolId/start - an illegal transition is a 409. */
export const startPool = (token, poolId) =>
  request(`/api/pools/${poolId}/start`, { method: "PATCH", headers: auth(token) });

/** PATCH /api/pools/:poolId/complete - settles each member's final fare. */
export const completePool = (token, poolId) =>
  request(`/api/pools/${poolId}/complete`, { method: "PATCH", headers: auth(token) });

/* --------------------------------------------------------- ride requests --- */

/** GET /api/ride-requests - the passenger's own requests. */
export const listRideRequests = (token) =>
  request("/api/ride-requests", { headers: auth(token) });

/** POST /api/ride-requests - the fare is priced by the API, not the client. */
export const createRideRequest = (token, payload) =>
  send("/api/ride-requests", token, "POST", payload);

/** PATCH /api/ride-requests/:id/cancel - only while still WAITING. */
export const cancelRideRequest = (token, id) =>
  request(`/api/ride-requests/${id}/cancel`, { method: "PATCH", headers: auth(token) });

/**
 * GET /api/ride-requests/available - the driver's matching queue.
 *
 * Requests the driver already declined are left out by the API, so declining does
 * not need to be tracked on the client.
 */
export const listAvailableRideRequests = (token) =>
  request("/api/ride-requests/available", { headers: auth(token) });

/** POST /api/ride-requests/:id/decline - a driver's "not this one". */
export const declineRideRequest = (token, id) =>
  request(`/api/ride-requests/${id}/decline`, { method: "POST", headers: auth(token) });

/* --------------------------------------------------------------- ratings --- */

/**
 * POST /api/ratings - both parties score the other.
 *
 * Only `poolId` and `score` are sent. The API works out whether the caller was
 * that pool's driver or one of its passengers, and scores the other side, so
 * `raterId`/`rateeId` are never client-controlled.
 */
export const createRating = (token, poolId, score) =>
  send("/api/ratings", token, "POST", { poolId, score });
