-- The default scoring version of a new DiagnosticAssessment is now
-- FOUR_SKILL_PLACEMENT_V2, the only version this build runs.
-- It changes the column default only. No row is read, updated or deleted, so
-- it is safe for `prisma migrate deploy` to run it on every container start.
ALTER TABLE "DiagnosticAssessment" ALTER COLUMN "scoringVersion" SET DEFAULT 'FOUR_SKILL_PLACEMENT_V2';
