-- Vocab decks gain a learner-facing description and a CEFR level (F12.8).
ALTER TABLE "VocabTopic" ADD COLUMN "description" TEXT,
ADD COLUMN "level" TEXT;
