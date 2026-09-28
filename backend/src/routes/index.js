import { Router } from 'express';

import healthRoutes from './health.routes.js';

const router = Router();

/**
 * API v1 surface. New feature routers get mounted here:
 *   router.use('/auth', authRoutes);
 *   router.use('/rides', rideRoutes);
 */
router.use('/health', healthRoutes);

export default router;
