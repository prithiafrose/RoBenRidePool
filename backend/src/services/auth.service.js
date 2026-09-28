import bcrypt from 'bcrypt';

import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { signAccessToken } from '../utils/jwt.js';

const BCRYPT_SALT_ROUNDS = 10;

/**
 * Compared against when the email is unknown, so a missing account and a
 * wrong password take a similar amount of time (less user enumeration).
 */
const DUMMY_HASH = bcrypt.hashSync('roben-ridepool-dummy-password', BCRYPT_SALT_ROUNDS);

/** Fields that are safe to return. `passwordHash` is deliberately absent. */
const toSafeUser = ({ id, name, email, role, createdAt }) => ({
  id,
  name,
  email,
  role,
  createdAt,
});

/** Emails are stored lower-cased so uniqueness is case-insensitive. */
const normalizeEmail = (email) => email.trim().toLowerCase();

export const registerUser = async ({ name, email, password, role }) => {
  const normalizedEmail = normalizeEmail(email);

  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (existingUser) {
    throw AppError.conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const user = await prisma.user.create({
    data: { name, email: normalizedEmail, passwordHash, role },
  });

  return { user: toSafeUser(user), token: signAccessToken(user) };
};

export const loginUser = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw AppError.unauthorized('Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw AppError.unauthorized('Invalid email or password');
  }

  return { user: toSafeUser(user), token: signAccessToken(user) };
};

/** Profile lookup for `GET /api/auth/me`. */
export const getUserById = async (id) => {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    throw AppError.unauthorized('Account no longer exists');
  }

  return toSafeUser(user);
};
