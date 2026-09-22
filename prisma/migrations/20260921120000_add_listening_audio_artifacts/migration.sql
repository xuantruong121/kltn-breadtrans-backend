-- Additive quiz-level production audio artifacts.
-- Existing QuizAudioAsset rows and keys are intentionally untouched.
CREATE TYPE "ListeningAudioArtifactStatus" AS ENUM (
  'GENERATING',
  'PREVIEW_READY',
  'APPROVED',
  'PUBLISHED',
  'STALE',
  'FAILED'
);

CREATE TABLE "ListeningAudioArtifact" (
  "id" SERIAL NOT NULL,
  "quizId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "synthesisHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "status" "ListeningAudioArtifactStatus" NOT NULL DEFAULT 'GENERATING',
  "provider" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "accent" TEXT NOT NULL,
  "voiceRegistryVersion" TEXT NOT NULL,
  "outputFormat" TEXT NOT NULL,
  "r2Key" TEXT,
  "r2Url" TEXT,
  "durationMs" INTEGER,
  "checksumSha256" TEXT,
  "timeline" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" INTEGER,
  "publishedAt" TIMESTAMP(3),
  "publishedBy" INTEGER,
  CONSTRAINT "ListeningAudioArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListeningAudioArtifact_quizId_version_key"
  ON "ListeningAudioArtifact"("quizId", "version");
CREATE UNIQUE INDEX "ListeningAudioArtifact_quizId_synthesisHash_key"
  ON "ListeningAudioArtifact"("quizId", "synthesisHash");
CREATE INDEX "ListeningAudioArtifact_quizId_status_idx"
  ON "ListeningAudioArtifact"("quizId", "status");
CREATE INDEX "ListeningAudioArtifact_synthesisHash_idx"
  ON "ListeningAudioArtifact"("synthesisHash");

ALTER TABLE "ListeningAudioArtifact"
  ADD CONSTRAINT "ListeningAudioArtifact_quizId_fkey"
  FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
