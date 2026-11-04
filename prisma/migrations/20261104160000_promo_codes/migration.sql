-- B4 promo codes. Additive except PlanPurchase.listPriceVnd, which every
-- existing purchase gets from its own amountVnd (none had a discount), so the
-- frozen-terms check (amountVnd = listPriceVnd - discountVnd) holds for them.

-- CreateEnum
CREATE TYPE "PromoCodeSource" AS ENUM ('ADMIN', 'WINBACK');

-- AlterTable: add nullable, backfill, then require.
ALTER TABLE "PlanPurchase" ADD COLUMN "discountVnd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "listPriceVnd" INTEGER,
ADD COLUMN "promoCodeId" INTEGER;

UPDATE "PlanPurchase" SET "listPriceVnd" = "amountVnd" WHERE "listPriceVnd" IS NULL;

ALTER TABLE "PlanPurchase" ALTER COLUMN "listPriceVnd" SET NOT NULL;

ALTER TABLE "PlanPurchase" ADD CONSTRAINT "PlanPurchase_discount_valid"
  CHECK ("discountVnd" >= 0 AND "amountVnd" = "listPriceVnd" - "discountVnd");
-- CreateTable
CREATE TABLE "PromoCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "planCodes" TEXT[],
    "maxRedemptions" INTEGER,
    "perUserOnce" BOOLEAN NOT NULL DEFAULT true,
    "source" "PromoCodeSource" NOT NULL DEFAULT 'ADMIN',
    "userId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" SERIAL NOT NULL,
    "promoCodeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "planPurchaseId" INTEGER NOT NULL,
    "discountVnd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_userId_idx" ON "PromoCode"("userId");

-- CreateIndex
CREATE INDEX "PromoCode_source_createdAt_idx" ON "PromoCode"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_planPurchaseId_key" ON "PromoRedemption"("planPurchaseId");

-- CreateIndex
CREATE INDEX "PromoRedemption_promoCodeId_idx" ON "PromoRedemption"("promoCodeId");

-- CreateIndex
CREATE INDEX "PromoRedemption_userId_promoCodeId_idx" ON "PromoRedemption"("userId", "promoCodeId");

-- AddForeignKey
ALTER TABLE "PlanPurchase" ADD CONSTRAINT "PlanPurchase_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_percentOff_range"
  CHECK ("percentOff" BETWEEN 1 AND 90);
