-- Adaptive vocabulary review (owner 2026-11-11): each word keeps its own
-- interval and ease instead of the fixed 1/3/7/14/30/60-day ladder.
ALTER TABLE "UserVocabWordProgress"
  ADD COLUMN "intervalDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  ADD COLUMN "lapses" INTEGER NOT NULL DEFAULT 0;

-- Words already on a schedule keep it: the interval is the gap the old
-- ladder gave them. A gap under a day (the ten-minute relearn) stays 0.
UPDATE "UserVocabWordProgress"
SET "intervalDays" = LEAST(
  365,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ("nextReviewAt" - "lastReviewedAt")) / 86400 + 0.5)::INTEGER)
)
WHERE "nextReviewAt" IS NOT NULL AND "lastReviewedAt" IS NOT NULL;
