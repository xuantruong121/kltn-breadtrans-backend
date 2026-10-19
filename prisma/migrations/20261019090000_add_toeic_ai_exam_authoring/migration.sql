-- Phase 8.9B: additive provenance and media-freshness metadata for AI TOEIC
-- practice drafts. Existing content and learner attempts are intentionally
-- untouched.
ALTER TABLE "Exam" ADD COLUMN "aiGenerationJobId" TEXT;
CREATE UNIQUE INDEX "Exam_aiGenerationJobId_key" ON "Exam"("aiGenerationJobId");

ALTER TABLE "ToeicQuestionGroup"
  ADD COLUMN "transcriptText" TEXT,
  ADD COLUMN "imageBrief" TEXT,
  ADD COLUMN "mediaMetadata" JSONB;
