-- Phase 5: durable, admin-only AI authoring lifecycle.
CREATE TYPE "AiGenerationJobType" AS ENUM ('SMART_CONTENT', 'DICTATION', 'TOEIC_QUIZ', 'ETS_IMPORT');
CREATE TYPE "AiGenerationJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'GENERATED', 'FAILED', 'APPROVED', 'PUBLISHED', 'CANCELLED');

CREATE TABLE "AiGenerationJob" (
  "id" TEXT NOT NULL,
  "createdByAdminId" INTEGER NOT NULL,
  "reviewedByAdminId" INTEGER,
  "publishedByAdminId" INTEGER,
  "generationType" "AiGenerationJobType" NOT NULL,
  "status" "AiGenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT,
  "requestSnapshot" JSONB NOT NULL,
  "resultSnapshot" JSONB,
  "draftSnapshot" JSONB,
  "approvedSnapshot" JSONB,
  "provider" TEXT,
  "model" TEXT,
  "generatorVersion" TEXT,
  "promptVersion" TEXT,
  "providerUsage" JSONB,
  "errorSummary" TEXT,
  "failureHistory" JSONB,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "publishedResources" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiGenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGenerationJob_idempotencyKey_key" ON "AiGenerationJob"("idempotencyKey");
CREATE INDEX "AiGenerationJob_status_createdAt_idx" ON "AiGenerationJob"("status", "createdAt");
CREATE INDEX "AiGenerationJob_generationType_createdAt_idx" ON "AiGenerationJob"("generationType", "createdAt");
CREATE INDEX "AiGenerationJob_createdByAdminId_createdAt_idx" ON "AiGenerationJob"("createdByAdminId", "createdAt");

ALTER TABLE "AiGenerationJob"
  ADD CONSTRAINT "AiGenerationJob_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGenerationJob"
  ADD CONSTRAINT "AiGenerationJob_reviewedByAdminId_fkey"
  FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiGenerationJob"
  ADD CONSTRAINT "AiGenerationJob_publishedByAdminId_fkey"
  FOREIGN KEY ("publishedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
