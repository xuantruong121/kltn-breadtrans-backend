-- AlterTable SpeakingSubmission: add post-processing lease token and startedAt fields
ALTER TABLE "SpeakingSubmission"
  ADD COLUMN "feedbackStartedAt" TIMESTAMP(3),
  ADD COLUMN "feedbackWorkerId" TEXT,
  ADD COLUMN "rewardStartedAt" TIMESTAMP(3),
  ADD COLUMN "rewardWorkerId" TEXT;

-- CreateIndex for lease timeout scans
CREATE INDEX "SpeakingSubmission_feedbackStatus_feedbackStartedAt_idx" ON "SpeakingSubmission"("feedbackStatus", "feedbackStartedAt");
CREATE INDEX "SpeakingSubmission_rewardStatus_rewardStartedAt_idx" ON "SpeakingSubmission"("rewardStatus", "rewardStartedAt");

-- CreateTable SpeakingRewardLedger for durable per-side-effect idempotency
CREATE TABLE "SpeakingRewardLedger" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "rewardType" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakingRewardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingRewardLedger_submissionId_rewardType_reference_key" ON "SpeakingRewardLedger"("submissionId", "rewardType", "reference");
CREATE INDEX "SpeakingRewardLedger_userId_rewardType_idx" ON "SpeakingRewardLedger"("userId", "rewardType");

-- AddForeignKey
ALTER TABLE "SpeakingRewardLedger" ADD CONSTRAINT "SpeakingRewardLedger_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "SpeakingSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpeakingRewardLedger" ADD CONSTRAINT "SpeakingRewardLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
