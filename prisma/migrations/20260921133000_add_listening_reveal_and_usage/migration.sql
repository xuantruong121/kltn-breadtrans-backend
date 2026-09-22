-- Additive migration: durable transcript reveal actions and authoring usage evidence.
CREATE TABLE "ListeningTranscriptReveal" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "quizId" INTEGER NOT NULL,
  "attemptId" INTEGER NOT NULL,
  "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListeningTranscriptReveal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListeningTranscriptReveal_userId_quizId_key"
  ON "ListeningTranscriptReveal"("userId", "quizId");
CREATE INDEX "ListeningTranscriptReveal_quizId_revealedAt_idx"
  ON "ListeningTranscriptReveal"("quizId", "revealedAt");
ALTER TABLE "ListeningTranscriptReveal"
  ADD CONSTRAINT "ListeningTranscriptReveal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListeningTranscriptReveal"
  ADD CONSTRAINT "ListeningTranscriptReveal_quizId_fkey"
  FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ListeningAudioUsage" (
  "id" SERIAL NOT NULL,
  "quizId" INTEGER NOT NULL,
  "artifactId" INTEGER,
  "actorId" INTEGER,
  "provider" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "synthesisHash" TEXT NOT NULL,
  "characterCount" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "durationMs" INTEGER,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListeningAudioUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListeningAudioUsage_quizId_createdAt_idx"
  ON "ListeningAudioUsage"("quizId", "createdAt");
CREATE INDEX "ListeningAudioUsage_synthesisHash_idx"
  ON "ListeningAudioUsage"("synthesisHash");
ALTER TABLE "ListeningAudioUsage"
  ADD CONSTRAINT "ListeningAudioUsage_quizId_fkey"
  FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListeningAudioUsage"
  ADD CONSTRAINT "ListeningAudioUsage_artifactId_fkey"
  FOREIGN KEY ("artifactId") REFERENCES "ListeningAudioArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListeningAudioUsage"
  ADD CONSTRAINT "ListeningAudioUsage_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
