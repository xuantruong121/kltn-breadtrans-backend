-- AlterEnum
ALTER TYPE "SpeakingUploadIntentStatus" ADD VALUE 'FINALIZING';

-- AlterTable
ALTER TABLE "SpeakingUploadIntent" ADD COLUMN "finalizationStartedAt" TIMESTAMP(3),
ADD COLUMN "finalizationToken" TEXT;

-- Backfill NULL idempotencyKey if any exists before enforcing NOT NULL
UPDATE "SpeakingUploadIntent"
SET "idempotencyKey" = 'legacy-idemp-' || "id"
WHERE "idempotencyKey" IS NULL;

-- Enforce NOT NULL on idempotencyKey
ALTER TABLE "SpeakingUploadIntent" ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- CreateIndex
CREATE INDEX "SpeakingUploadIntent_status_finalizationStartedAt_idx" ON "SpeakingUploadIntent"("status", "finalizationStartedAt");
