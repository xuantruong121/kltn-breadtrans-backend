-- Additive commercial-plan foundation. Existing course/payment tables are untouched.
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PlanVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "PlanFeatureKey" AS ENUM (
  'AI_SPEAKING_ASSESSMENT',
  'AI_WRITING_REVIEW',
  'AI_TUTOR_MESSAGE',
  'AI_EXPLANATION',
  'PREMIUM_VOCAB'
);
CREATE TYPE "EntitlementUnit" AS ENUM (
  'REQUEST_COUNT',
  'SUBMISSIONS',
  'CHARACTERS',
  'TOKENS',
  'AUDIO_SECONDS',
  'CONTENT_ACCESS'
);
CREATE TYPE "EntitlementPeriod" AS ENUM (
  'DAY',
  'CALENDAR_MONTH',
  'BILLING_CYCLE',
  'LIFETIME'
);
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

CREATE TABLE "Plan" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanVersion" (
  "id" SERIAL NOT NULL,
  "planId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "displayName" TEXT,
  "description" TEXT,
  "durationDays" INTEGER,
  "priceVnd" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "status" "PlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanVersion_durationDays_nonnegative" CHECK ("durationDays" IS NULL OR "durationDays" > 0),
  CONSTRAINT "PlanVersion_priceVnd_nonnegative" CHECK ("priceVnd" IS NULL OR "priceVnd" >= 0)
);

CREATE TABLE "PlanEntitlement" (
  "id" SERIAL NOT NULL,
  "planVersionId" INTEGER NOT NULL,
  "featureKey" "PlanFeatureKey" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limitValue" INTEGER,
  "unit" "EntitlementUnit",
  "period" "EntitlementPeriod",
  "scope" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanEntitlement_limitValue_nonnegative" CHECK ("limitValue" IS NULL OR "limitValue" >= 0)
);

CREATE TABLE "Subscription" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "planVersionId" INTEGER NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Subscription_endsAt_after_startsAt" CHECK ("endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE UNIQUE INDEX "PlanVersion_planId_version_key" ON "PlanVersion"("planId", "version");
CREATE INDEX "PlanVersion_planId_status_idx" ON "PlanVersion"("planId", "status");
CREATE INDEX "PlanVersion_status_effectiveFrom_idx" ON "PlanVersion"("status", "effectiveFrom");
CREATE UNIQUE INDEX "PlanEntitlement_planVersionId_featureKey_key" ON "PlanEntitlement"("planVersionId", "featureKey");
CREATE INDEX "PlanEntitlement_featureKey_enabled_idx" ON "PlanEntitlement"("featureKey", "enabled");
CREATE INDEX "Subscription_userId_status_startsAt_endsAt_idx" ON "Subscription"("userId", "status", "startsAt", "endsAt");
CREATE INDEX "Subscription_planVersionId_idx" ON "Subscription"("planVersionId");

ALTER TABLE "PlanVersion"
  ADD CONSTRAINT "PlanVersion_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanEntitlement"
  ADD CONSTRAINT "PlanEntitlement_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
