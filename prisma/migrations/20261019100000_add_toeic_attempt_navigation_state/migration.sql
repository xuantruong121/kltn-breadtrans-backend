ALTER TABLE "ToeicAttempt"
ADD COLUMN "currentQuestionId" INTEGER,
ADD COLUMN "markedQuestionIds" JSONB NOT NULL DEFAULT '[]';
