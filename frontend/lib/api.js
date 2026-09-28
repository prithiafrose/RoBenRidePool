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
