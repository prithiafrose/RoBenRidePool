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
