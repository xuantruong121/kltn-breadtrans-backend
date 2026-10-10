-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketFulfillmentType') THEN
    CREATE TYPE "MarketFulfillmentType" AS ENUM ('DIGITAL', 'PHYSICAL');
  END IF;
END $$;

-- AlterTable MarketProduct
ALTER TABLE "MarketProduct" ADD COLUMN IF NOT EXISTS "fulfillmentType" "MarketFulfillmentType" NOT NULL DEFAULT 'DIGITAL';

-- CreateTable UserShippingProfile
CREATE TABLE IF NOT EXISTS "UserShippingProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'VN',
    "provinceCode" TEXT NOT NULL,
    "provinceName" TEXT NOT NULL,
    "wardCode" TEXT NOT NULL,
    "wardName" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserShippingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable MarketPhysicalRedemption
CREATE TABLE IF NOT EXISTS "MarketPhysicalRedemption" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'VN',
    "provinceCode" TEXT NOT NULL,
    "provinceName" TEXT NOT NULL,
    "wardCode" TEXT NOT NULL,
    "wardName" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "formattedAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPhysicalRedemption_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "UserShippingProfile_userId_key" ON "UserShippingProfile"("userId");
CREATE INDEX IF NOT EXISTS "UserShippingProfile_userId_idx" ON "UserShippingProfile"("userId");
CREATE INDEX IF NOT EXISTS "MarketPhysicalRedemption_userId_idx" ON "MarketPhysicalRedemption"("userId");
CREATE INDEX IF NOT EXISTS "MarketPhysicalRedemption_orderId_idx" ON "MarketPhysicalRedemption"("orderId");
CREATE INDEX IF NOT EXISTS "MarketPhysicalRedemption_status_idx" ON "MarketPhysicalRedemption"("status");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserShippingProfile_userId_fkey'
  ) THEN
    ALTER TABLE "UserShippingProfile" ADD CONSTRAINT "UserShippingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketPhysicalRedemption_userId_fkey'
  ) THEN
    ALTER TABLE "MarketPhysicalRedemption" ADD CONSTRAINT "MarketPhysicalRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketPhysicalRedemption_orderId_fkey'
  ) THEN
    ALTER TABLE "MarketPhysicalRedemption" ADD CONSTRAINT "MarketPhysicalRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing physical products explicitly
UPDATE "MarketProduct"
SET "fulfillmentType" = 'PHYSICAL'
WHERE "slug" IN ('gift-notebook', 'gift-bottle', 'gift-plush');

UPDATE "MarketProduct"
SET "fulfillmentType" = 'DIGITAL'
WHERE "slug" NOT IN ('gift-notebook', 'gift-bottle', 'gift-plush');
