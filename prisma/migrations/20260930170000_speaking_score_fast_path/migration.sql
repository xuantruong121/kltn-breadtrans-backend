-- Additive speaking post-processing state. Existing submissions remain valid.
CREATE TYPE "SpeakingFeedbackStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "SpeakingRewardStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "SpeakingSubmission"
  ADD COLUMN "feedbackStatus" "SpeakingFeedbackStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "feedbackError" TEXT,
  ADD COLUMN "feedbackProcessedAt" TIMESTAMP(3),
  ADD COLUMN "rewardStatus" "SpeakingRewardStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "rewardError" TEXT,
  ADD COLUMN "rewardProcessedAt" TIMESTAMP(3);

CREATE INDEX "SpeakingSubmission_feedbackStatus_idx" ON "SpeakingSubmission"("feedbackStatus");
CREATE INDEX "SpeakingSubmission_rewardStatus_idx" ON "SpeakingSubmission"("rewardStatus");
