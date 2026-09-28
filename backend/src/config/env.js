import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, '../..');
const rootDir = path.resolve(backendDir, '..');

// backend/.env wins over the shared repo-root .env, because dotenv
// never overwrites variables that are already defined.
dotenv.config({ path: path.join(backendDir, '.env'), quiet: true });
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const toPort = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** Single source of truth for every environment-dependent setting. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toPort(process.env.PORT, 5000),
  // Accepts a comma-separated list of origins, e.g. "http://localhost:3000,https://app.example.com".
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
};

export const isProduction = env.nodeEnv === 'production';
