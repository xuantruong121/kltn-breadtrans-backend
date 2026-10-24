-- CreateEnum
CREATE TYPE "ToeicAttemptSection" AS ENUM ('LISTENING', 'READING');

-- AlterTable: strict Full Test section state only. All new columns are
-- nullable or default-0, so every existing ToeicAttempt row (Practice or
-- already-submitted Full Test) stays valid with no backfill required.
ALTER TABLE "ToeicAttempt"
  ADD COLUMN "section" "ToeicAttemptSection",
  ADD COLUMN "listeningPosition" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readingStartedAt" TIMESTAMP(3),
  ADD COLUMN "readingDeadline" TIMESTAMP(3);
