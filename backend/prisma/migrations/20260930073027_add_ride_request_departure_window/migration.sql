/*
  Warnings:

  - Added the required column `departureFrom` to the `ride_requests` table without a default value. This is not possible if the table is not empty.
  - Added the required column `departureTo` to the `ride_requests` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ride_requests" ADD COLUMN     "departureFrom" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "departureTo" TIMESTAMP(3) NOT NULL;
