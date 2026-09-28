import { PrismaClient } from '@prisma/client';

import { env } from './env.js';

// Reuse a single client across hot reloads in development, otherwise each
// reload would open a new connection pool to PostgreSQL.
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__robenRidePoolPrisma ??
  new PrismaClient({
    log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.nodeEnv !== 'production') {
  globalForPrisma.__robenRidePoolPrisma = prisma;
}
