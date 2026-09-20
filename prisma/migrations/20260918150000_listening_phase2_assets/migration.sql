-- Publication workflow and versioned Listening media.
CREATE TYPE "QuizPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

ALTER TABLE "Quiz"
  ADD COLUMN "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "Quiz" SET "publishedAt" = "createdAt"
WHERE "publicationStatus" = 'PUBLISHED' AND "publishedAt" IS NULL;

CREATE TABLE "QuizAudioAsset" (
  "id" SERIAL NOT NULL,
  "questionId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "durationMs" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuizAudioAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListeningDiagnosticClip" (
  "id" SERIAL NOT NULL,
  "questionId" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "startMs" INTEGER,
  "endMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListeningDiagnosticClip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuizAudioAsset_questionId_version_key"
  ON "QuizAudioAsset"("questionId", "version");
CREATE INDEX "QuizAudioAsset_questionId_isActive_idx"
  ON "QuizAudioAsset"("questionId", "isActive");
CREATE INDEX "ListeningDiagnosticClip_questionId_createdAt_idx"
  ON "ListeningDiagnosticClip"("questionId", "createdAt");

ALTER TABLE "QuizAudioAsset"
  ADD CONSTRAINT "QuizAudioAsset_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListeningDiagnosticClip"
  ADD CONSTRAINT "ListeningDiagnosticClip_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
