-- Add explicit learner-engine targets for TOEIC and Grammar CourseActivity rows.
-- Nullable columns preserve all existing course activity records.
ALTER TABLE "CourseActivity" ADD COLUMN "toeicExamId" INTEGER;
ALTER TABLE "CourseActivity" ADD COLUMN "grammarTopicId" INTEGER;

CREATE INDEX "CourseActivity_toeicExamId_idx" ON "CourseActivity"("toeicExamId");
CREATE INDEX "CourseActivity_grammarTopicId_idx" ON "CourseActivity"("grammarTopicId");

ALTER TABLE "CourseActivity"
  ADD CONSTRAINT "CourseActivity_toeicExamId_fkey"
  FOREIGN KEY ("toeicExamId") REFERENCES "ToeicExamSet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseActivity"
  ADD CONSTRAINT "CourseActivity_grammarTopicId_fkey"
  FOREIGN KEY ("grammarTopicId") REFERENCES "GrammarTopic"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
