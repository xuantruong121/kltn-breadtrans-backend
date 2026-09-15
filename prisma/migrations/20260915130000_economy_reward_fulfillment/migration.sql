-- Preserve an earned first-completion reward when the daily cap temporarily
-- prevents it from being granted, and make checkout requests idempotent.
ALTER TABLE "UserVocabMasteryReward"
  ADD COLUMN "banhGranted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UserToeicReward"
  ADD COLUMN "banhGranted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MarketOrder"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "MarketOrder_idempotencyKey_key"
  ON "MarketOrder"("idempotencyKey");

-- Preserve the settlement state of rewards created by the prior migration.
UPDATE "UserVocabMasteryReward" reward
SET "banhGranted" = 1
WHERE EXISTS (
  SELECT 1
  FROM "BanhTransaction" transaction
  WHERE transaction."userId" = reward."userId"
    AND transaction."source" = 'VOCAB_MASTERY'
    AND transaction."reference" = 'vocab:word:' || reward."wordId"::text
    AND transaction."amount" > 0
);

UPDATE "UserToeicReward" reward
SET "banhGranted" = COALESCE((
  SELECT SUM(transaction."amount")::integer
  FROM "BanhTransaction" transaction
  WHERE transaction."userId" = reward."userId"
    AND transaction."source" = 'TOEIC_COMPLETION'
    AND transaction."reference" =
      'toeic:' || reward."examId"::text || ':' || reward."mode"
), 0);
