-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ratings_rateeId_createdAt_idx" ON "ratings"("rateeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_poolId_raterId_key" ON "ratings"("poolId", "raterId");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rateeId_fkey" FOREIGN KEY ("rateeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
