import { Router } from 'express';

import availabilityRoutes from './availability.routes.js';
import authRoutes from './auth.routes.js';
import driverProfileRoutes from './driverProfile.routes.js';
import healthRoutes from './health.routes.js';
import poolRoutes from './pool.routes.js';
import ratingRoutes from './rating.routes.js';
import rideRequestRoutes from './rideRequest.routes.js';

const router = Router();

/**
 * API v1 surface. New feature routers get mounted here, alphabetically by
 * import and then by mount, for example `router.use('/payments', paymentRoutes)`.
 */
router.use('/health', healthRoutes);
router.use('/availability', availabilityRoutes);
router.use('/auth', authRoutes);
router.use('/driver-profile', driverProfileRoutes);
router.use('/pools', poolRoutes);
router.use('/ratings', ratingRoutes);
router.use('/ride-requests', rideRequestRoutes);

export default router;
