-- Rollback of migration 20261122120000_drop_speaking_category.
--
-- NOT RUN by any script or deploy step. Run it by hand only, after
-- `npm run db:backup`, and only with the CSV files from the EXPORT step
-- below: the migration dropped the values, and those files are the only
-- copy outside a backup. A full rollback is the restore of that backup; this
-- file is for when the data written since the migration must be kept.
--
-- EXPORT, before `prisma migrate deploy` runs 20261122120000, in one psql
-- session on the database to be migrated. One read-only snapshot, so the
-- three files agree. The files land in psql's working directory (inside a
-- container: `docker cp` them out).
--
-- BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
-- \copy (SELECT "id", "code", "name", "nameNormalized", "description", "isActive", "sortOrder", "allowPracticeSet", "allowExercise", "createdAt", "updatedAt" FROM "SpeakingCategory" ORDER BY "id") TO 'speaking_category.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
-- \copy (SELECT "id", "category", "categoryId" FROM "SpeakingPracticeSet" ORDER BY "id") TO 'speaking_set_category.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
-- \copy (SELECT "id", "category", "categoryId" FROM "SpeakingExercise" ORDER BY "id") TO 'speaking_exercise_category.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
-- COMMIT;
--
-- ROLLBACK, in this order:
--   1. Stop the backend, so nothing writes between steps 2 and 4.
--   2. Run this file: psql -v ON_ERROR_STOP=1 -f <this file>. One
--      transaction; it changes nothing if a statement fails.
--   3. Run the IMPORT block at the end, in one psql session (also with
--      ON_ERROR_STOP=1) started in the folder that holds the three CSV files.
--   4. Start a backend build from before the migration.
--
-- This file recreates the table, its indexes, the four columns, their
-- indexes and their foreign keys as migrations 20260906000000,
-- 20261009120000, 20261015120000 and 20261025054012 left them, then deletes
-- this migration's row in _prisma_migrations. The two SpeakingPracticeSet
-- columns stay nullable until the IMPORT block has put their values back;
-- its last statement makes them NOT NULL again. The re-added columns come
-- last in their tables; Prisma does not depend on column order.

BEGIN;

-- 1. The table ("updatedAt" lost its default in 20261025054012).
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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpeakingCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpeakingCategory_code_key" ON "SpeakingCategory"("code");
CREATE UNIQUE INDEX "SpeakingCategory_nameNormalized_key" ON "SpeakingCategory"("nameNormalized");

-- 2. The columns. An exercise made after the drop gets the old default
-- 'TOEIC' and no category id, as the old schema gave it.
ALTER TABLE "SpeakingExercise" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'TOEIC';
ALTER TABLE "SpeakingExercise" ADD COLUMN "categoryId" INTEGER;
ALTER TABLE "SpeakingPracticeSet" ADD COLUMN "category" TEXT;
ALTER TABLE "SpeakingPracticeSet" ADD COLUMN "categoryId" INTEGER;

-- 3. Their indexes and foreign keys.
CREATE INDEX "SpeakingPracticeSet_categoryId_idx" ON "SpeakingPracticeSet"("categoryId");
CREATE INDEX "SpeakingExercise_categoryId_idx" ON "SpeakingExercise"("categoryId");

ALTER TABLE "SpeakingPracticeSet"
  ADD CONSTRAINT "SpeakingPracticeSet_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "SpeakingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SpeakingExercise"
  ADD CONSTRAINT "SpeakingExercise_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "SpeakingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Prisma forgets the migration.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261122120000_drop_speaking_category';

COMMIT;

-- IMPORT, right after this file, in one psql session. It puts the values
-- back, gives a set made after the drop GENERAL (what the old create path
-- gave a new set), and makes the two set columns NOT NULL again. A row that
-- is in a file but no longer in its table is skipped. If no GENERAL category
-- came back, the last statement fails and the block changes nothing.
--
-- BEGIN;
-- \copy "SpeakingCategory" ("id", "code", "name", "nameNormalized", "description", "isActive", "sortOrder", "allowPracticeSet", "allowExercise", "createdAt", "updatedAt") FROM 'speaking_category.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
-- SELECT setval(pg_get_serial_sequence('"SpeakingCategory"', 'id'), COALESCE(MAX("id"), 1), COUNT(*) > 0) FROM "SpeakingCategory";
-- CREATE TEMP TABLE speaking_set_category ("id" TEXT PRIMARY KEY, "category" TEXT NOT NULL, "categoryId" INTEGER NOT NULL) ON COMMIT DROP;
-- \copy speaking_set_category FROM 'speaking_set_category.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
-- CREATE TEMP TABLE speaking_exercise_category ("id" INTEGER PRIMARY KEY, "category" TEXT NOT NULL, "categoryId" INTEGER) ON COMMIT DROP;
-- \copy speaking_exercise_category FROM 'speaking_exercise_category.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
-- UPDATE "SpeakingPracticeSet" s SET "category" = c."category", "categoryId" = c."categoryId" FROM speaking_set_category c WHERE s."id" = c."id";
-- UPDATE "SpeakingExercise" e SET "category" = c."category", "categoryId" = c."categoryId" FROM speaking_exercise_category c WHERE e."id" = c."id";
-- UPDATE "SpeakingPracticeSet" SET "category" = 'GENERAL', "categoryId" = (SELECT "id" FROM "SpeakingCategory" WHERE "code" = 'GENERAL') WHERE "categoryId" IS NULL;
-- ALTER TABLE "SpeakingPracticeSet" ALTER COLUMN "category" SET NOT NULL, ALTER COLUMN "categoryId" SET NOT NULL;
-- COMMIT;
