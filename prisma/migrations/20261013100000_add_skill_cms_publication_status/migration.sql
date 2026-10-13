-- Add the Speaking publication boundary without hiding existing learner content.
ALTER TABLE "SpeakingExercise"
  ADD COLUMN "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'PUBLISHED';

ALTER TABLE "SpeakingPracticeSet"
  ADD COLUMN "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'PUBLISHED';

-- New CMS records use DRAFT; existing rows were intentionally backfilled above.
ALTER TABLE "SpeakingExercise"
  ALTER COLUMN "publicationStatus" SET DEFAULT 'DRAFT';

ALTER TABLE "SpeakingPracticeSet"
  ALTER COLUMN "publicationStatus" SET DEFAULT 'DRAFT';
