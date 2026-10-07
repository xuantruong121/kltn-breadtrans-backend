ALTER TYPE "PlanPurchaseStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "PlanPurchaseStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
ALTER TYPE "PlanPaymentStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';
ALTER TYPE "PlanPaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "PlanPaymentStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "PlanPurchase"
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "supersededByPurchaseId" INTEGER;

ALTER TABLE "PlanPayment"
  ADD COLUMN "supersededAt" TIMESTAMP(3);

CREATE INDEX "PlanPurchase_supersededByPurchaseId_idx"
  ON "PlanPurchase"("supersededByPurchaseId");

ALTER TABLE "PlanPurchase"
  ADD CONSTRAINT "PlanPurchase_supersededByPurchaseId_fkey"
  FOREIGN KEY ("supersededByPurchaseId") REFERENCES "PlanPurchase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
