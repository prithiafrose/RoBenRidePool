import { Router } from 'express';

import authRoutes from './auth.routes.js';
import driverProfileRoutes from './driverProfile.routes.js';
import healthRoutes from './health.routes.js';
import rideRequestRoutes from './rideRequest.routes.js';

const router = Router();

/**
 * API v1 surface. New feature routers get mounted here:
 *   router.use('/pools', poolRoutes);
 */
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/driver-profile', driverProfileRoutes);
router.use('/ride-requests', rideRequestRoutes);

export default router;
