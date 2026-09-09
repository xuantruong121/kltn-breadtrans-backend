-- CreateEnum
CREATE TYPE "SpeakingSubmissionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "SpeakingSubmission" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "audioKey" TEXT,
ADD COLUMN     "audioMimeType" TEXT,
ADD COLUMN     "audioQuality" JSONB,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "lastErrorMessage" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingStartedAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT DEFAULT 'azure',
ADD COLUMN     "rewardGrantedAt" TIMESTAMP(3),
ADD COLUMN     "scoreVersion" TEXT DEFAULT 'v1',
ADD COLUMN     "status" "SpeakingSubmissionStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "transcript" TEXT,
ALTER COLUMN "audioUrl" DROP NOT NULL;

-- Backfill existing historical submissions to COMPLETED with processedAt & rewardGrantedAt
UPDATE "SpeakingSubmission"
SET "status" = 'COMPLETED',
    "processedAt" = "submittedAt",
    "rewardGrantedAt" = "submittedAt"
WHERE "overallScore" IS NOT NULL OR "aiFeedback" IS NOT NULL;

-- CreateIndex
CREATE INDEX "SpeakingSubmission_status_nextAttemptAt_idx" ON "SpeakingSubmission"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SpeakingSubmission_userId_submittedAt_idx" ON "SpeakingSubmission"("userId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingSubmission_userId_idempotencyKey_key" ON "SpeakingSubmission"("userId", "idempotencyKey");
