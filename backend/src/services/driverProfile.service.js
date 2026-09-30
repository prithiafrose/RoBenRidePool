import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

/** Fields safe to return for a vehicle. No relations are selected at all. */
const toTesla = (tesla) => ({
  id: tesla.id,
  driverId: tesla.driverId,
  plateNumber: tesla.plateNumber,
  model: tesla.model,
  seatCapacity: tesla.seatCapacity,
  createdAt: tesla.createdAt,
  updatedAt: tesla.updatedAt,
});

/**
 * Fields safe to return for a driver profile. The `user` relation is
 * deliberately never selected, so `passwordHash` and the rest of the account
 * record cannot reach the response without having to enumerate what to hide.
 * The nested `tesla` is included because the client needs its id to create a
 * pool, and it holds no sensitive data.
 */
const toDriverProfile = (driverProfile) => ({
  id: driverProfile.id,
  userId: driverProfile.userId,
  status: driverProfile.status,
  createdAt: driverProfile.createdAt,
  updatedAt: driverProfile.updatedAt,
  tesla: driverProfile.tesla ? toTesla(driverProfile.tesla) : null,
});

/**
 * Prisma's unique-constraint violation. Both `driver_profiles.userId` and
 * `teslas.plateNumber` are unique, so the pre-checks below can still lose a
 * race; this is the backstop that turns that race into a readable 409 instead
 * of a 500.
 */
const isUniqueViolation = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * The authenticated driver's own profile.
 *
 * Reads by `userId`, the one value that comes from the verified access token, so
 * this can only ever return the caller's own profile - there is no id in the path
 * for a client to point somewhere else.
 *
 * Returns 404 rather than null while the driver has not onboarded. That is the
 * same answer `setDriverAvailability` gives, and it is what lets the dashboard
 * treat "no profile yet" as a state to onboard from rather than an empty object
 * it has to guess the meaning of.
 */
export const getDriverProfile = async (userId) => {
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { tesla: true },
  });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  return toDriverProfile(driverProfile);
};

/**
 * Onboards a driver: creates the DriverProfile and the single Tesla that the
 * schema allows it, atomically.
 *
 * `userId` comes from the verified access token, never from the body, and
 * `Tesla.driverId` comes from the profile created in the same transaction.
 * Because the vehicle is always attached to a profile the caller just created
 * for themselves, no client input can point a Tesla at another driver, which is
 * what `Pool.vehicleId` relies on further down the line.
 *
 * `status` is omitted from the insert so PostgreSQL applies the `OFFLINE`
 * default: a new driver is never online before they say so.
 *
 * The two writes share a transaction because neither is useful alone. Without
 * it, a driver whose plate number collided would be left with a permanent
 * profile and no vehicle, unable to retry.
 */
export const createDriverProfile = async (userId, vehicle) => {
  const existingProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (existingProfile) {
    throw AppError.conflict('Driver profile already exists');
  }

  const existingVehicle = await prisma.tesla.findUnique({
    where: { plateNumber: vehicle.plateNumber },
  });

  if (existingVehicle) {
    throw AppError.conflict('A vehicle with this plate number already exists');
  }

  try {
    const driverProfile = await prisma.$transaction(async (tx) => {
      const createdProfile = await tx.driverProfile.create({ data: { userId } });

      const createdTesla = await tx.tesla.create({
        data: { ...vehicle, driverId: createdProfile.id },
      });

      return { ...createdProfile, tesla: createdTesla };
    });

    return toDriverProfile(driverProfile);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The pre-checks lost a concurrent race. `driver_profiles.userId` and
      // `teslas.plateNumber` are both unique, so the failing column tells us
      // which message the caller should see. The rolled-back profile leaves
      // nothing behind, so the driver can retry with a different plate.
      const target = String(error.meta?.target ?? '');

      if (target.includes('plateNumber')) {
        throw AppError.conflict('A vehicle with this plate number already exists');
      }

      throw AppError.conflict('Driver profile already exists');
    }

    throw error;
  }
};

/**
 * Records whether the authenticated driver is available to take passengers.
 *
 * This is the only place `DriverProfile.status` is ever written after onboarding.
 * Onboarding deliberately leaves it at the Prisma default of `OFFLINE` (see
 * `createDriverProfile` above), so a driver is never online before they say so,
 * and this endpoint is where they say it.
 *
 * The profile is found by the `userId` in the verified access token, never by an
 * id from the request. That is the whole reason a driver cannot set somebody
 * else's availability: the row is chosen from the token, so a client that sends
 * `userId` or `driverId` is not naming anything the update uses. No other field
 * is written, so a caller cannot smuggle anything else onto the row either.
 *
 * Onboarding is a prerequisite rather than something to work around, exactly as
 * in the four pool endpoints: a driver with no `DriverProfile` has no row to
 * update, so it gets the same 404 that names what is missing.
 *
 * The `tesla` relation is read so the response is the same `toDriverProfile`
 * shape as onboarding, which keeps one DTO for the entity instead of two
 * partial ones that drift apart.
 */
export const setDriverAvailability = async (userId, status) => {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

  if (!driverProfile) {
    throw AppError.notFound('Driver profile not found');
  }

  const updated = await prisma.driverProfile.update({
    where: { id: driverProfile.id },
    data: { status },
    include: { tesla: true },
  });

  return toDriverProfile(updated);
};
