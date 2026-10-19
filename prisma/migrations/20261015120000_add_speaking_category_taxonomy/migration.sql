-- Additive Speaking taxonomy migration. Legacy category strings remain intact.
CREATE TABLE "SpeakingCategory" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "allowPracticeSet" BOOLEAN NOT NULL DEFAULT false,
    "allowExercise" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpeakingCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpeakingCategory_code_key" ON "SpeakingCategory"("code");
CREATE UNIQUE INDEX "SpeakingCategory_nameNormalized_key" ON "SpeakingCategory"("nameNormalized");

ALTER TABLE "SpeakingPracticeSet" ADD COLUMN "categoryId" INTEGER;
ALTER TABLE "SpeakingExercise" ADD COLUMN "categoryId" INTEGER;

INSERT INTO "SpeakingCategory"
  ("code", "name", "nameNormalized", "sortOrder", "allowPracticeSet", "allowExercise")
VALUES
  ('GENERAL', 'Chung', 'chung', 10, true, true),
  ('TOEIC', 'TOEIC', 'toeic', 20, true, true),
  ('BUSINESS', 'Công việc', 'cong viec', 30, true, true),
  ('ACADEMIC', 'Học thuật', 'hoc thuat', 40, false, true),
  ('DAILY_LIFE', 'Đời sống hằng ngày', 'doi song hang ngay', 50, false, true);

UPDATE "SpeakingPracticeSet" AS target
SET "categoryId" = taxonomy."id"
FROM "SpeakingCategory" AS taxonomy
WHERE taxonomy."code" = target."category";

UPDATE "SpeakingExercise" AS target
SET "categoryId" = taxonomy."id"
FROM "SpeakingCategory" AS taxonomy
WHERE taxonomy."code" = target."category";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SpeakingPracticeSet" WHERE "categoryId" IS NULL) THEN
    RAISE EXCEPTION 'Speaking taxonomy backfill left unmapped PracticeSet rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "SpeakingExercise" WHERE "categoryId" IS NULL) THEN
    RAISE EXCEPTION 'Speaking taxonomy backfill left unmapped Exercise rows';
  END IF;
END $$;

ALTER TABLE "SpeakingPracticeSet" ALTER COLUMN "categoryId" SET NOT NULL;

CREATE INDEX "SpeakingPracticeSet_categoryId_idx" ON "SpeakingPracticeSet"("categoryId");
CREATE INDEX "SpeakingExercise_categoryId_idx" ON "SpeakingExercise"("categoryId");

ALTER TABLE "SpeakingPracticeSet"
  ADD CONSTRAINT "SpeakingPracticeSet_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "SpeakingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SpeakingExercise"
  ADD CONSTRAINT "SpeakingExercise_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "SpeakingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
