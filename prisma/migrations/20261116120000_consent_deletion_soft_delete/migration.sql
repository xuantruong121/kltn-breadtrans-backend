-- Consent evidence, self-service deletion fields, and the soft-delete rule
-- (owner 2026-11-16): orders, physical redemptions, the Bánh Mì ledger and
-- used promo codes are no longer deleted together with their user.

-- DropForeignKey
ALTER TABLE "BanhTransaction" DROP CONSTRAINT "BanhTransaction_userId_fkey";

-- DropForeignKey
ALTER TABLE "MarketOrder" DROP CONSTRAINT "MarketOrder_userId_fkey";

-- DropForeignKey
ALTER TABLE "MarketPhysicalRedemption" DROP CONSTRAINT "MarketPhysicalRedemption_userId_fkey";

-- DropForeignKey
ALTER TABLE "PromoRedemption" DROP CONSTRAINT "PromoRedemption_userId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionScheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "document" VARCHAR(16) NOT NULL,
    "version" VARCHAR(16) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserConsent_userId_document_idx" ON "UserConsent"("userId", "document");

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPhysicalRedemption" ADD CONSTRAINT "MarketPhysicalRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanhTransaction" ADD CONSTRAINT "BanhTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
