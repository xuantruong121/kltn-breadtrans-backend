-- Phân loại (SpeakingCategory) was folded into Lĩnh vực on 2026-11-21
-- (20261121120000_learning_track_table): a speaking set is tagged through
-- SpeakingSetTrack, and no code reads the old category any more. This drops
-- the table and the four columns that pointed at it or copied its code.
--
-- Before deploying, export the three CSV files named at the top of
-- docs/migrations/speaking-category-drop-rollback.sql; that file and those
-- exports are the way back.

-- 1. The foreign keys to the table.
ALTER TABLE "SpeakingPracticeSet" DROP CONSTRAINT "SpeakingPracticeSet_categoryId_fkey";
ALTER TABLE "SpeakingExercise" DROP CONSTRAINT "SpeakingExercise_categoryId_fkey";

-- 2. Their indexes.
DROP INDEX "SpeakingPracticeSet_categoryId_idx";
DROP INDEX "SpeakingExercise_categoryId_idx";

-- 3. The id columns and the legacy code strings.
ALTER TABLE "SpeakingPracticeSet" DROP COLUMN "categoryId",
DROP COLUMN "category";
ALTER TABLE "SpeakingExercise" DROP COLUMN "categoryId",
DROP COLUMN "category";

-- 4. The table, with its two unique indexes and its id sequence.
DROP TABLE "SpeakingCategory";
