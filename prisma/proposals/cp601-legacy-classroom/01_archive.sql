-- CP60.1 step M1 — archive legacy classroom/tuition storage (NON-DESTRUCTIVE).
--
-- NOT a Prisma migration and NOT applied to kltn_db. Owner approval required
-- before running it on a protected database (take and restore-verify a backup
-- first). Idempotent: re-running refreshes nothing and fails on nothing; it
-- copies only rows that are not archived yet.
--
-- Copies every row of the retired classroom domain into schema
-- legacy_archive, unchanged, with the archive time. Public tables are not
-- touched, so the running application is unaffected.

BEGIN;

CREATE SCHEMA IF NOT EXISTS legacy_archive;

CREATE TABLE IF NOT EXISTS legacy_archive."Class"                (LIKE public."Class"                INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."Enrollment"           (LIKE public."Enrollment"           INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."Payment"              (LIKE public."Payment"              INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."Assignment"           (LIKE public."Assignment"           INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."AssignmentSubmission" (LIKE public."AssignmentSubmission" INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."Announcement"         (LIKE public."Announcement"         INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."WatchTracking"        (LIKE public."WatchTracking"        INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."UserBilling"          (LIKE public."UserBilling"          INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS legacy_archive."PayOSPaymentIntent_course"
  (LIKE public."PayOSPaymentIntent" INCLUDING DEFAULTS);

-- Enum-typed columns are stored as text in the archive so that a later enum
-- removal (step M2) cannot invalidate archived rows.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'legacy_archive' AND c.data_type = 'USER-DEFINED'
  LOOP
    EXECUTE format('ALTER TABLE legacy_archive.%I ALTER COLUMN %I DROP DEFAULT', r.table_name, r.column_name);
    EXECUTE format('ALTER TABLE legacy_archive.%I ALTER COLUMN %I TYPE text USING %I::text', r.table_name, r.column_name, r.column_name);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Class','Enrollment','Payment','Assignment','AssignmentSubmission','Announcement','WatchTracking','UserBilling','PayOSPaymentIntent_course']
  LOOP
    -- The archive must not depend on the public id sequences (M2 drops them).
    EXECUTE format('ALTER TABLE legacy_archive.%I ALTER COLUMN id DROP DEFAULT', t);
    EXECUTE format('ALTER TABLE legacy_archive.%I ADD COLUMN IF NOT EXISTS "archivedAt" timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON legacy_archive.%I (id)', t || '_archive_id', t);
  END LOOP;
END $$;

INSERT INTO legacy_archive."Class"                SELECT p.*, now() FROM public."Class" p                ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."Enrollment"           SELECT p.*, now() FROM public."Enrollment" p           ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."Payment"              SELECT p.*, now() FROM public."Payment" p              ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."Assignment"           SELECT p.*, now() FROM public."Assignment" p           ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."AssignmentSubmission" SELECT p.*, now() FROM public."AssignmentSubmission" p ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."Announcement"         SELECT p.*, now() FROM public."Announcement" p         ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."WatchTracking"        SELECT p.*, now() FROM public."WatchTracking" p        ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."UserBilling"          SELECT p.*, now() FROM public."UserBilling" p          ON CONFLICT (id) DO NOTHING;
INSERT INTO legacy_archive."PayOSPaymentIntent_course"
  SELECT p.*, now() FROM public."PayOSPaymentIntent" p WHERE p.type::text = 'COURSE' ON CONFLICT (id) DO NOTHING;

COMMIT;
