-- Additive Entry Diagnostic Speaking persistence. Existing attempts remain valid.
ALTER TABLE "DiagnosticAttempt"
  ADD COLUMN "status" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "submissionToken" TEXT;

-- Existing rows are already finalized under the v2 contract; do not turn them
-- into resumable attempts when this additive migration is applied.
UPDATE "DiagnosticAttempt"
SET "status" = 'COMPLETED', "completedAt" = COALESCE("completedAt", "submittedAt")
WHERE "status" IS NULL;

ALTER TABLE "DiagnosticAttempt"
  ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS',
  ALTER COLUMN "status" SET NOT NULL;

CREATE INDEX "DiagnosticAttempt_userId_assessmentId_status_idx"
  ON "DiagnosticAttempt"("userId", "assessmentId", "status");

CREATE TABLE "DiagnosticSpeakingResponse" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "assessmentId" INTEGER NOT NULL,
  "attemptId" INTEGER NOT NULL,
  "questionId" INTEGER NOT NULL,
  "taskKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "audioKey" TEXT,
  "audioMimeType" TEXT,
  "byteSize" INTEGER,
  "durationMs" INTEGER,
  "transcript" TEXT,
  "score" DOUBLE PRECISION,
  "scoreMetadata" JSONB,
  "provider" TEXT,
  "graderVersion" TEXT,
  "gradingAttempts" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "gradedAt" TIMESTAMP(3),
  CONSTRAINT "DiagnosticSpeakingResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagnosticSpeakingResponse_attemptId_questionId_key"
  ON "DiagnosticSpeakingResponse"("attemptId", "questionId");
CREATE INDEX "DiagnosticSpeakingResponse_userId_assessmentId_status_idx"
  ON "DiagnosticSpeakingResponse"("userId", "assessmentId", "status");
CREATE INDEX "DiagnosticSpeakingResponse_attemptId_status_idx"
  ON "DiagnosticSpeakingResponse"("attemptId", "status");

ALTER TABLE "DiagnosticSpeakingResponse"
  ADD CONSTRAINT "DiagnosticSpeakingResponse_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticSpeakingResponse"
  ADD CONSTRAINT "DiagnosticSpeakingResponse_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "DiagnosticAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticSpeakingResponse"
  ADD CONSTRAINT "DiagnosticSpeakingResponse_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "DiagnosticAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticSpeakingResponse"
  ADD CONSTRAINT "DiagnosticSpeakingResponse_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "DiagnosticQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
