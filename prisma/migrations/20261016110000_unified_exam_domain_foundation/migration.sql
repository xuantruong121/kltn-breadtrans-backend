-- Additive generic Exam product root. Existing domain tables and attempt history remain authoritative.
CREATE TYPE "SpeakingPracticeScope" AS ENUM ('SKILL_PRACTICE', 'EXAM_INTERNAL');

CREATE TABLE "Exam" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "familyCode" TEXT NOT NULL,
    "variantCode" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SpeakingPracticeSet"
  ADD COLUMN "scope" "SpeakingPracticeScope" NOT NULL DEFAULT 'SKILL_PRACTICE';

ALTER TABLE "ToeicExamSet" ADD COLUMN "examId" INTEGER;
ALTER TABLE "ToeicAssessment" ADD COLUMN "examId" INTEGER;

-- Preserve the existing TOEIC L&R identity by using the legacy set id as the
-- initial generic root id. This avoids duplicate learner products and makes
-- rollback/diagnostics deterministic without touching questions or attempts.
INSERT INTO "Exam" ("id", "title", "description", "familyCode", "variantCode", "templateKey", "publicationStatus", "createdBy", "createdAt", "updatedAt")
SELECT "id", "title", "description", 'TOEIC', 'TOEIC_LR', 'TOEIC_LR_V1', "publicationStatus", "createdBy", "createdAt", "updatedAt"
FROM "ToeicExamSet";

UPDATE "ToeicExamSet" SET "examId" = "id";

SELECT setval(
  pg_get_serial_sequence('"Exam"', 'id'),
  COALESCE((SELECT MAX("id") FROM "Exam"), 1),
  true
);

CREATE UNIQUE INDEX "ToeicExamSet_examId_key" ON "ToeicExamSet"("examId");
CREATE UNIQUE INDEX "ToeicAssessment_examId_key" ON "ToeicAssessment"("examId");
CREATE INDEX "Exam_familyCode_variantCode_publicationStatus_idx" ON "Exam"("familyCode", "variantCode", "publicationStatus");
CREATE INDEX "Exam_templateKey_idx" ON "Exam"("templateKey");
CREATE INDEX "SpeakingPracticeSet_scope_idx" ON "SpeakingPracticeSet"("scope");

ALTER TABLE "Exam" ADD CONSTRAINT "Exam_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ToeicExamSet" ADD CONSTRAINT "ToeicExamSet_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessment" ADD CONSTRAINT "ToeicAssessment_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
