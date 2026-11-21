-- Selective rollback of migration 20261121120000_learning_track_table.
--
-- NOT RUN by any script or deploy step. Run it by hand only, on a database
-- whose backend has been switched back to a build from before the
-- migration, and only after `npm run db:backup`. A full rollback is the
-- restore of that backup; this file is for when the data written since the
-- migration must be kept.
--
-- What it does, in one transaction:
--   1. Refuses (RAISE) when a learner choice or a tag uses a track outside
--      the six original codes: the old enum cannot hold it.
--   2. Moves speaking set tags back to ContentTrackTag (contentType
--      SPEAKING_SET), keyed by each set's first PUBLISHED exercise (order
--      asc, id asc), the key the old recommender read. A set without a
--      published exercise loses its tags; their number is reported.
--   3. Drops SpeakingSetTrack and the foreign keys to LearningTrack.
--   4. Drops the LearningTrack table, recreates the LearningTrack enum, casts
--      both columns back to it and restores the default.
--   5. Deletes this migration's row in _prisma_migrations, so a later
--      `prisma migrate deploy` would apply it again.
--
-- Track names, descriptions, order and on/off state live only in the table
-- and are lost; the old enum had none of them.

BEGIN;

-- 1. Only the six original codes can go back into the enum.
DO $$
DECLARE
    stray TEXT;
BEGIN
    SELECT string_agg(DISTINCT used.code, ', ' ORDER BY used.code) INTO stray
    FROM (
        SELECT "track" AS code FROM "LearnerProfile"
        UNION SELECT "track" FROM "ContentTrackTag"
        UNION SELECT "track" FROM "SpeakingSetTrack"
    ) used
    WHERE used.code NOT IN ('GENERAL', 'IT_SOFTWARE', 'OFFICE_BUSINESS',
                            'SALES_CUSTOMER_SERVICE', 'HOSPITALITY_TOURISM',
                            'STUDENT_ACADEMIC');
    IF stray IS NOT NULL THEN
        RAISE EXCEPTION 'learning_track rollback refused: tracks outside the original six are in use: %. Retag or delete those rows first.', stray;
    END IF;
END $$;

-- 2. Speaking set tags back on the set's first published exercise.
DO $$
DECLARE
    keyless INTEGER;
BEGIN
    SELECT COUNT(*) INTO keyless
    FROM "SpeakingSetTrack" st
    WHERE NOT EXISTS (
        SELECT 1 FROM "SpeakingExercise" e
        WHERE e."practiceSetId" = st."setId" AND e."publicationStatus" = 'PUBLISHED'
    );
    IF keyless > 0 THEN
        RAISE NOTICE 'learning_track rollback: % speaking set tag(s) are on sets without a published exercise and are dropped', keyless;
    END IF;
END $$;

INSERT INTO "ContentTrackTag" ("contentType", "contentId", "track", "createdById", "createdAt")
SELECT 'SPEAKING_SET'::"LearningContentType", first_exercise.id, st."track", st."createdById", st."createdAt"
FROM "SpeakingSetTrack" st
JOIN LATERAL (
    SELECT e.id
    FROM "SpeakingExercise" e
    WHERE e."practiceSetId" = st."setId" AND e."publicationStatus" = 'PUBLISHED'
    ORDER BY e."order" ASC, e.id ASC
    LIMIT 1
) first_exercise ON true
ON CONFLICT DO NOTHING;

-- 3. The set tag table and the foreign keys to LearningTrack.
DROP TABLE "SpeakingSetTrack";

ALTER TABLE "LearnerProfile" DROP CONSTRAINT "LearnerProfile_track_fkey";
ALTER TABLE "ContentTrackTag" DROP CONSTRAINT "ContentTrackTag_track_fkey";
DROP INDEX "LearnerProfile_track_idx";

-- 4. The table goes first: its row type holds the name the enum needs.
DROP TABLE "LearningTrack";

CREATE TYPE "LearningTrack" AS ENUM ('GENERAL', 'IT_SOFTWARE', 'OFFICE_BUSINESS', 'SALES_CUSTOMER_SERVICE', 'HOSPITALITY_TOURISM', 'STUDENT_ACADEMIC');

ALTER TABLE "LearnerProfile" ALTER COLUMN "track" DROP DEFAULT;
ALTER TABLE "LearnerProfile" ALTER COLUMN "track" TYPE "LearningTrack" USING "track"::"LearningTrack";
ALTER TABLE "LearnerProfile" ALTER COLUMN "track" SET DEFAULT 'GENERAL';
ALTER TABLE "ContentTrackTag" ALTER COLUMN "track" TYPE "LearningTrack" USING "track"::"LearningTrack";

-- 5. Prisma forgets the migration.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261121120000_learning_track_table';

COMMIT;
