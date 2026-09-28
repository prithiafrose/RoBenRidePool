/**
 * Health checks.
 *
 * Kept in a service so additional probes (database reachability, uptime...)
 * can be added later without changing the HTTP layer.
 */
const startedAt = Date.now();

export const getApiHealth = () => ({
  message: 'RoBen RidePool API is running',
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  timestamp: new Date().toISOString(),
});
