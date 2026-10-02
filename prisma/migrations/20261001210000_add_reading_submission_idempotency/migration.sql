-- Additive Reading submission idempotency metadata.
-- Nullable values preserve all historical and legacy submissions.
ALTER TABLE "Submission" ADD COLUMN "clientAttemptId" VARCHAR(36);

CREATE UNIQUE INDEX "Submission_userId_quizId_clientAttemptId_key"
ON "Submission"("userId", "quizId", "clientAttemptId");

CREATE INDEX "Submission_userId_clientAttemptId_idx"
ON "Submission"("userId", "clientAttemptId");
