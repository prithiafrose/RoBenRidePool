import { sendSuccess } from '../utils/apiResponse.js';

import { getApiHealth } from '../services/health.service.js';

/**
 * GET /api/health
 * Used by docker-compose health checks, uptime monitors and the frontend
 * status card.
 */
export const health = async (req, res) => {
  const { message, ...details } = getApiHealth();
  return sendSuccess(res, details, 200, message);
};
