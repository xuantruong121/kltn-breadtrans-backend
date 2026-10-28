-- CP60.1 step M2 — retire the legacy classroom storage (DESTRUCTIVE).
--
-- NOT a Prisma migration. Requires, in this order:
--   1. separate owner approval for a destructive change to kltn_db;
--   2. a fresh protected backup, restore-verified;
--   3. M1 applied and 02_verify.sql all match = t on the same database;
--   4. the code change that removes the Prisma models Class, Enrollment,
--      Payment, Assignment, AssignmentSubmission, Announcement,
--      WatchTracking, UserBilling, the relations on User and Course, the
--      coursePayment relation on PayOSPaymentIntent, the enums ClassStatus,
--      EnrollmentStatus, PaymentStatus, PaymentActivationIssue,
--      AssignmentType, and the Payment-count delete guards in AdminService
--      and CourseService — deployed together with this script.
--
-- It refuses to run unless the archive is complete. Rollback: 11_rollback_storage.sql.

BEGIN;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(name, ', ') INTO missing FROM (
    SELECT 'Class' AS name WHERE (SELECT count(*) FROM public."Class") <> (SELECT count(*) FROM legacy_archive."Class")
    UNION ALL SELECT 'Enrollment' WHERE (SELECT count(*) FROM public."Enrollment") <> (SELECT count(*) FROM legacy_archive."Enrollment")
    UNION ALL SELECT 'Payment' WHERE (SELECT count(*) FROM public."Payment") <> (SELECT count(*) FROM legacy_archive."Payment")
    UNION ALL SELECT 'Assignment' WHERE (SELECT count(*) FROM public."Assignment") <> (SELECT count(*) FROM legacy_archive."Assignment")
    UNION ALL SELECT 'AssignmentSubmission' WHERE (SELECT count(*) FROM public."AssignmentSubmission") <> (SELECT count(*) FROM legacy_archive."AssignmentSubmission")
    UNION ALL SELECT 'Announcement' WHERE (SELECT count(*) FROM public."Announcement") <> (SELECT count(*) FROM legacy_archive."Announcement")
    UNION ALL SELECT 'WatchTracking' WHERE (SELECT count(*) FROM public."WatchTracking") <> (SELECT count(*) FROM legacy_archive."WatchTracking")
    UNION ALL SELECT 'UserBilling' WHERE (SELECT count(*) FROM public."UserBilling") <> (SELECT count(*) FROM legacy_archive."UserBilling")
    UNION ALL SELECT 'PayOSPaymentIntent COURSE' WHERE (SELECT count(*) FROM public."PayOSPaymentIntent" WHERE type::text = 'COURSE') <> (SELECT count(*) FROM legacy_archive."PayOSPaymentIntent_course")
  ) m;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'archive incomplete for: % (run 01_archive.sql and 02_verify.sql first)', missing;
  END IF;
END $$;

-- Retired classroom tuition intents leave the live table (their copy is archived).
ALTER TABLE public."PayOSPaymentIntent" DROP CONSTRAINT IF EXISTS "PayOSPaymentIntent_coursePaymentId_fkey";
DELETE FROM public."PayOSPaymentIntent" WHERE type::text = 'COURSE';
ALTER TABLE public."PayOSPaymentIntent" DROP COLUMN IF EXISTS "coursePaymentId";

DROP TABLE IF EXISTS public."Payment";
DROP TABLE IF EXISTS public."AssignmentSubmission";
DROP TABLE IF EXISTS public."Assignment";
DROP TABLE IF EXISTS public."Announcement";
DROP TABLE IF EXISTS public."Enrollment";
DROP TABLE IF EXISTS public."Class";
DROP TABLE IF EXISTS public."WatchTracking";
DROP TABLE IF EXISTS public."UserBilling";

DROP TYPE IF EXISTS public."ClassStatus";
DROP TYPE IF EXISTS public."EnrollmentStatus";
DROP TYPE IF EXISTS public."PaymentStatus";
DROP TYPE IF EXISTS public."PaymentActivationIssue";
DROP TYPE IF EXISTS public."AssignmentType";

-- PayOSPaymentIntentType keeps only PLAN.
ALTER TYPE public."PayOSPaymentIntentType" RENAME TO "PayOSPaymentIntentType_old";
CREATE TYPE public."PayOSPaymentIntentType" AS ENUM ('PLAN');
ALTER TABLE public."PayOSPaymentIntent"
  ALTER COLUMN type TYPE public."PayOSPaymentIntentType" USING type::text::public."PayOSPaymentIntentType";
DROP TYPE public."PayOSPaymentIntentType_old";

COMMIT;
