/**
 * Thin client for the RoBen RidePool REST API.
 * NEXT_PUBLIC_API_URL is inlined at build time, so it must be prefixed with
 * NEXT_PUBLIC_ to be visible in the browser.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

const REQUEST_TIMEOUT_MS = 5000;

const request = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`API responded with status ${response.status}`);
  }

  return response.json();
};

/** Health probe used by the dashboard status card. */
export const getApiHealth = () => request("/api/health");
