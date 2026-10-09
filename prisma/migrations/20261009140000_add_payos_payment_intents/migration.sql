CREATE TYPE "PaymentProvider" AS ENUM ('SEPAY', 'PAYOS');

CREATE TYPE "PayOSPaymentIntentType" AS ENUM ('PLAN', 'COURSE');

CREATE TYPE "PayOSPaymentIntentStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'PAID',
  'CANCELLED',
  'EXPIRED',
  'UNDERPAID',
  'FAILED'
);

CREATE TABLE "PayOSPaymentIntent" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" "PayOSPaymentIntentType" NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYOS',
  "orderCode" BIGINT NOT NULL,
  "paymentLinkId" TEXT,
  "planPaymentId" INTEGER,
  "coursePaymentId" INTEGER,
  "amountVnd" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "description" TEXT NOT NULL,
  "checkoutUrl" TEXT,
  "qrCode" TEXT,
  "status" "PayOSPaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
  "providerStatus" TEXT,
  "expiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayOSPaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayOSPaymentIntent_orderCode_key" ON "PayOSPaymentIntent"("orderCode");
CREATE UNIQUE INDEX "PayOSPaymentIntent_paymentLinkId_key" ON "PayOSPaymentIntent"("paymentLinkId");
CREATE UNIQUE INDEX "PayOSPaymentIntent_planPaymentId_key" ON "PayOSPaymentIntent"("planPaymentId");
CREATE UNIQUE INDEX "PayOSPaymentIntent_coursePaymentId_key" ON "PayOSPaymentIntent"("coursePaymentId");
CREATE INDEX "PayOSPaymentIntent_userId_status_createdAt_idx" ON "PayOSPaymentIntent"("userId", "status", "createdAt");
CREATE INDEX "PayOSPaymentIntent_type_status_createdAt_idx" ON "PayOSPaymentIntent"("type", "status", "createdAt");

ALTER TABLE "PayOSPaymentIntent"
  ADD CONSTRAINT "PayOSPaymentIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayOSPaymentIntent"
  ADD CONSTRAINT "PayOSPaymentIntent_planPaymentId_fkey"
  FOREIGN KEY ("planPaymentId") REFERENCES "PlanPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayOSPaymentIntent"
  ADD CONSTRAINT "PayOSPaymentIntent_coursePaymentId_fkey"
  FOREIGN KEY ("coursePaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
