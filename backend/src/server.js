import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`RoBen RidePool API listening on http://localhost:${env.port} [${env.nodeEnv}]`);
});

/** Close the HTTP server and the database pool before exiting. */
const shutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down...`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  // Do not hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
