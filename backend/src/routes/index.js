import { Router } from 'express';

import authRoutes from './auth.routes.js';
import healthRoutes from './health.routes.js';

const router = Router();

/**
 * API v1 surface. New feature routers get mounted here:
 *   router.use('/rides', rideRoutes);
 */
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

export default router;
