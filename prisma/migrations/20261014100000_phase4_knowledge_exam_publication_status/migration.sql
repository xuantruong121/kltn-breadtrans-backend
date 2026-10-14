-- AlterTable VocabTopic: Add column with PUBLISHED default for existing data, then set default to DRAFT for new records
ALTER TABLE "VocabTopic"
  ADD COLUMN "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE "VocabTopic"
  ALTER COLUMN "publicationStatus" SET DEFAULT 'DRAFT';

-- AlterTable GrammarTopic: Add column with PUBLISHED default for existing data, then set default to DRAFT for new records
ALTER TABLE "GrammarTopic"
  ADD COLUMN "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE "GrammarTopic"
  ALTER COLUMN "publicationStatus" SET DEFAULT 'DRAFT';

-- AlterTable ToeicExamSet: Add column with PUBLISHED default for existing data, then set default to DRAFT for new records
ALTER TABLE "ToeicExamSet"
  ADD COLUMN "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ToeicExamSet"
  ALTER COLUMN "publicationStatus" SET DEFAULT 'DRAFT';
