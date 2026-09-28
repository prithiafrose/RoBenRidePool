import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/*.test.js'],
    globalSetup: ['tests/setup/globalSetup.js'],
    setupFiles: ['tests/setup/db.js'],
    // Integration tests share one PostgreSQL database, so they must not run
    // concurrently or the truncation in `beforeEach` would race.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
