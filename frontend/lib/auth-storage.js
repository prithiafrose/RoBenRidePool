/**
 * Access-token storage for the MVP.
 *
 * Decision: keep the token in `localStorage` instead of an httpOnly cookie.
 * Rationale: the API is stateless and token-based, and localStorage is
 * readable by both the login and register pages without a server round trip.
 *
 * Trade-off, accepted for the MVP: `localStorage` is readable by any script on
 * the origin, so it is vulnerable to XSS. Before production this moves to an
 * httpOnly, Secure, SameSite cookie with a CSRF strategy, which also enables
 * the refresh-token flow that the MVP does not need yet.
 */
const TOKEN_KEY = "robenridepool.token";
const USER_KEY = "robenridepool.user";

const canUseStorage = () => typeof window !== "undefined" && !!window.localStorage;

export const saveSession = ({ token, user }) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const getToken = () => (canUseStorage() ? window.localStorage.getItem(TOKEN_KEY) : null);

export const getStoredUser = () => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};

export const clearSession = () => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
};
