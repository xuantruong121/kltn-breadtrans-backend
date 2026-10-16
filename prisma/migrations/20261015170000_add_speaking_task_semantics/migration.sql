-- Additive Speaking task semantics and reusable stimulus support.
CREATE TYPE "SpeakingExerciseTaskType" AS ENUM (
  'READ_ALOUD',
  'DESCRIBE_PICTURE',
  'RESPOND_TO_QUESTION',
  'RESPOND_USING_INFORMATION',
  'EXPRESS_OPINION',
  'PRONUNCIATION_DRILL'
);

CREATE TYPE "SpeakingStimulusKind" AS ENUM ('INFORMATION', 'IMAGE');

CREATE TABLE "SpeakingStimulus" (
  "id" SERIAL NOT NULL,
  "kind" "SpeakingStimulusKind" NOT NULL,
  "title" TEXT,
  "content" TEXT,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpeakingStimulus_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SpeakingExercise"
  ADD COLUMN "taskType" "SpeakingExerciseTaskType",
  ADD COLUMN "stimulusId" INTEGER;

CREATE INDEX "SpeakingExercise_taskType_idx" ON "SpeakingExercise"("taskType");
CREATE INDEX "SpeakingExercise_stimulusId_idx" ON "SpeakingExercise"("stimulusId");

ALTER TABLE "SpeakingExercise"
  ADD CONSTRAINT "SpeakingExercise_stimulusId_fkey"
  FOREIGN KEY ("stimulusId") REFERENCES "SpeakingStimulus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Audited, explicit backfill only. Unknown legacy rows remain nullable.
UPDATE "SpeakingExercise"
SET "taskType" = 'READ_ALOUD'
WHERE "practiceSetId" IN ('read-aloud-general', 'read-aloud-toeic');

UPDATE "SpeakingExercise"
SET "taskType" = 'PRONUNCIATION_DRILL'
WHERE "practiceSetId" = 'pronunciation-foundations';

UPDATE "SpeakingExercise"
SET "taskType" = 'RESPOND_TO_QUESTION'
WHERE "practiceSetId" IN ('question-response-general', 'question-response-business');

UPDATE "SpeakingExercise"
SET "taskType" = 'EXPRESS_OPINION'
WHERE "practiceSetId" IN ('opinion-general', 'opinion-business');

UPDATE "SpeakingExercise"
SET "taskType" = CASE "id"
  WHEN 25 THEN 'READ_ALOUD'::"SpeakingExerciseTaskType"
  WHEN 26 THEN 'READ_ALOUD'::"SpeakingExerciseTaskType"
  WHEN 27 THEN 'DESCRIBE_PICTURE'::"SpeakingExerciseTaskType"
  WHEN 28 THEN 'DESCRIBE_PICTURE'::"SpeakingExerciseTaskType"
  WHEN 29 THEN 'RESPOND_USING_INFORMATION'::"SpeakingExerciseTaskType"
  WHEN 30 THEN 'EXPRESS_OPINION'::"SpeakingExerciseTaskType"
END
WHERE "practiceSetId" = 'toeic-speaking-practice'
  AND "id" IN (25, 26, 27, 28, 29, 30);

INSERT INTO "SpeakingStimulus" ("kind", "title", "content", "createdAt", "updatedAt")
VALUES (
  'INFORMATION',
  'Seminar schedule',
  'Registration is at 9:00. The presentation begins at 10:00. Lunch is at 12:30. The workshop begins at 2:00.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

UPDATE "SpeakingExercise"
SET "stimulusId" = (
  SELECT "id" FROM "SpeakingStimulus"
  WHERE "kind" = 'INFORMATION' AND "title" = 'Seminar schedule'
  ORDER BY "id" DESC
  LIMIT 1
)
WHERE "id" = 29
  AND "practiceSetId" = 'toeic-speaking-practice';
