-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('PAYMENT_ACTIVATED', 'ADMIN_GRANTED', 'ADMIN_EXTENDED', 'ADMIN_REVOKED');

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" SERIAL NOT NULL,
    "subscriptionId" INTEGER NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "actorUserId" INTEGER,
    "reason" TEXT,
    "previousEndsAt" TIMESTAMP(3),
    "newEndsAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEvent_idempotencyKey_key" ON "SubscriptionEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_actorUserId_idx" ON "SubscriptionEvent"("actorUserId");

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
