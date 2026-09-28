import { afterAll, beforeEach } from 'vitest';

import { prisma } from '../../src/config/prisma.js';

/**
 * Every test starts from an empty table set, so tests never depend on records
 * left behind by a previous run or by manual setup in the database.
 */
beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
