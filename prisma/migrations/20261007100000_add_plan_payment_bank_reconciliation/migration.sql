CREATE TYPE "PlanPaymentConfirmationSource" AS ENUM ('ADMIN', 'AUTO_WEBHOOK');

CREATE TYPE "BankTransactionMatchStatus" AS ENUM (
  'RECEIVED',
  'MATCHED',
  'REVIEW_REQUIRED',
  'IGNORED',
  'DUPLICATE'
);

ALTER TABLE "PlanPayment"
  ADD COLUMN "bankBin" TEXT,
  ADD COLUMN "bankName" TEXT,
  ADD COLUMN "bankAccountNumber" TEXT,
  ADD COLUMN "paymentIntentExpiresAt" TIMESTAMP(3),
  ADD COLUMN "autoMatchUntil" TIMESTAMP(3),
  ADD COLUMN "confirmationSource" "PlanPaymentConfirmationSource";

CREATE TABLE "BankTransaction" (
  "id" SERIAL NOT NULL,
  "provider" TEXT NOT NULL,
  "externalTransactionId" TEXT NOT NULL,
  "bankReference" TEXT,
  "bankAccount" TEXT,
  "bankCode" TEXT,
  "gateway" TEXT,
  "transferType" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "paymentCode" TEXT,
  "rawContent" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "matchStatus" "BankTransactionMatchStatus" NOT NULL DEFAULT 'RECEIVED',
  "matchedPlanPaymentId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankTransaction_provider_externalTransactionId_key"
  ON "BankTransaction"("provider", "externalTransactionId");
CREATE INDEX "BankTransaction_matchStatus_receivedAt_idx"
  ON "BankTransaction"("matchStatus", "receivedAt");
CREATE INDEX "BankTransaction_matchedPlanPaymentId_idx"
  ON "BankTransaction"("matchedPlanPaymentId");
CREATE INDEX "PlanPayment_status_autoMatchUntil_idx"
  ON "PlanPayment"("status", "autoMatchUntil");

ALTER TABLE "BankTransaction"
  ADD CONSTRAINT "BankTransaction_matchedPlanPaymentId_fkey"
  FOREIGN KEY ("matchedPlanPaymentId") REFERENCES "PlanPayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
