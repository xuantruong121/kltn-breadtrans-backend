-- Practice attempts may cover only the Parts the learner selected.
-- Empty array = the whole exam (every existing attempt keeps that meaning).
ALTER TABLE "ToeicAttempt" ADD COLUMN "selectedParts" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
