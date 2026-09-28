import { z } from 'zod';

import { Role } from '@prisma/client';

/**
 * Email normalisation happens inside the schema, so the service layer always
 * receives a lower-cased, trimmed address. `.pipe()` is required because Zod
 * runs format checks before transforms on the same field.
 */
const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

/**
 * bcrypt only considers the first 72 bytes of a password, so anything longer
 * is rejected instead of being silently truncated.
 */
const password = z
  .string({ error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const registerSchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(80, 'Name must be at most 80 characters'),
  email,
  password,
  // `Role` comes from the Prisma schema, so the API and the database can
  // never drift apart.
  role: z.enum(Role, { error: 'Role must be PASSENGER or DRIVER' }),
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});
