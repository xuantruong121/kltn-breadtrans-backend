CREATE TYPE "PlanPurchaseStatus" AS ENUM ('PENDING_PAYMENT', 'COMPLETED', 'REJECTED');

CREATE TYPE "PlanPaymentStatus" AS ENUM ('PENDING', 'REPORTED', 'CONFIRMED', 'REJECTED');

CREATE TABLE "PlanPurchase" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "planVersionId" INTEGER NOT NULL,
    "status" "PlanPurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "amountVnd" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "durationDays" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPurchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanPurchase_amount_positive" CHECK ("amountVnd" > 0),
    CONSTRAINT "PlanPurchase_duration_positive" CHECK ("durationDays" > 0)
);

CREATE TABLE "PlanPayment" (
    "id" SERIAL NOT NULL,
    "planPurchaseId" INTEGER NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "transferCode" TEXT NOT NULL,
    "status" "PlanPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reportedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" INTEGER,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanPayment_amount_positive" CHECK ("amountVnd" > 0)
);

ALTER TABLE "Subscription" ADD COLUMN "planPurchaseId" INTEGER;

CREATE UNIQUE INDEX "PlanPurchase_userId_idempotencyKey_key" ON "PlanPurchase"("userId", "idempotencyKey");
CREATE INDEX "PlanPurchase_userId_createdAt_idx" ON "PlanPurchase"("userId", "createdAt");
CREATE INDEX "PlanPurchase_status_createdAt_idx" ON "PlanPurchase"("status", "createdAt");
CREATE INDEX "PlanPurchase_planVersionId_idx" ON "PlanPurchase"("planVersionId");
CREATE UNIQUE INDEX "PlanPayment_planPurchaseId_key" ON "PlanPayment"("planPurchaseId");
CREATE UNIQUE INDEX "PlanPayment_transferCode_key" ON "PlanPayment"("transferCode");
CREATE INDEX "PlanPayment_status_createdAt_idx" ON "PlanPayment"("status", "createdAt");
CREATE INDEX "PlanPayment_confirmedById_idx" ON "PlanPayment"("confirmedById");
CREATE INDEX "PlanPayment_rejectedById_idx" ON "PlanPayment"("rejectedById");
CREATE UNIQUE INDEX "Subscription_planPurchaseId_key" ON "Subscription"("planPurchaseId");

ALTER TABLE "PlanPurchase" ADD CONSTRAINT "PlanPurchase_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanPurchase" ADD CONSTRAINT "PlanPurchase_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanPayment" ADD CONSTRAINT "PlanPayment_planPurchaseId_fkey"
  FOREIGN KEY ("planPurchaseId") REFERENCES "PlanPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanPayment" ADD CONSTRAINT "PlanPayment_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanPayment" ADD CONSTRAINT "PlanPayment_rejectedById_fkey"
  FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planPurchaseId_fkey"
  FOREIGN KEY ("planPurchaseId") REFERENCES "PlanPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
