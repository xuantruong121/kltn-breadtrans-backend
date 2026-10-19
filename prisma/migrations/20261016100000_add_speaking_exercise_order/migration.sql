ALTER TABLE "SpeakingExercise" ADD COLUMN "order" INTEGER;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "practiceSetId"
      ORDER BY "id" ASC
    )::INTEGER AS "position"
  FROM "SpeakingExercise"
  WHERE "practiceSetId" IS NOT NULL
)
UPDATE "SpeakingExercise" AS exercise
SET "order" = ranked."position"
FROM ranked
WHERE exercise."id" = ranked."id";

ALTER TABLE "SpeakingExercise"
  ADD CONSTRAINT "SpeakingExercise_order_positive"
  CHECK ("order" IS NULL OR "order" >= 1);

CREATE UNIQUE INDEX "SpeakingExercise_practiceSetId_order_key"
  ON "SpeakingExercise"("practiceSetId", "order");
