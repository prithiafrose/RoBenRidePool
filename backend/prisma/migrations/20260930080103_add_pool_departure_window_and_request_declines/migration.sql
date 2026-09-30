/*
  Warnings:

  - Added the required column `departureFrom` to the `pools` table without a default value. This is not possible if the table is not empty.
  - Added the required column `departureTo` to the `pools` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "pools" ADD COLUMN     "departureFrom" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "departureTo" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "ride_request_declines" (
    "id" TEXT NOT NULL,
    "rideRequestId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_request_declines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ride_request_declines_driverId_createdAt_idx" ON "ride_request_declines"("driverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ride_request_declines_rideRequestId_driverId_key" ON "ride_request_declines"("rideRequestId", "driverId");

-- AddForeignKey
ALTER TABLE "ride_request_declines" ADD CONSTRAINT "ride_request_declines_rideRequestId_fkey" FOREIGN KEY ("rideRequestId") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_request_declines" ADD CONSTRAINT "ride_request_declines_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
