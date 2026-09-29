import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

// This file lives in `tests/setup/`, so the backend root is two levels up.
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootDir = path.resolve(backendDir, '..');

// Vitest loads this file before any application module, so `src/config/env.js`
// has not run yet. Load the same files, with the same precedence, or the
// database settings below would be read before .env had been applied.
dotenv.config({ path: path.join(backendDir, '.env'), quiet: true });
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

/**
 * Integration tests run against a real PostgreSQL database, but never the
 * development one. `TEST_DATABASE_URL` is required so a test run can never
 * wipe real data by accident.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  (process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, '/robenridepool_test$2')
    : undefined);

if (!TEST_DATABASE_URL) {
  throw new Error(
    'No test database configured. Set TEST_DATABASE_URL (or DATABASE_URL) before running tests.',
  );
}

// The API reads its configuration from here, so tests use the test database too.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-secret-not-used-in-production';
process.env.NODE_ENV = 'test';

/** Applies every pending migration so the schema matches `schema.prisma`. */
const applyMigrations = () => {
  // `shell: true` is required on Windows, where npx is a .cmd shim.
  execFileSync('npx prisma migrate deploy', {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    shell: true,
    stdio: 'pipe',
  });
};

/** Vitest global setup hook, runs once before the suite. */
export const setup = () => {
  applyMigrations();
};
