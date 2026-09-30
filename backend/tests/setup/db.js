import { afterAll, beforeEach } from 'vitest';

import { prisma } from '../../src/config/prisma.js';

/**
 * Every test starts from an empty table set, so tests never depend on records
 * left behind by a previous run or by manual setup in the database.
 *
 * Order matters: `pools` holds Restrict foreign keys to both the driver
 * profile and the vehicle, so it has to be emptied before the users it points
 * at. Deleting a user cascades down to the profile, and a pool still pointing
 * at that profile makes PostgreSQL refuse the whole delete. Pools come first
 * because their own `members` are removed by cascade.
 */
beforeEach(async () => {
  await prisma.pool.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
