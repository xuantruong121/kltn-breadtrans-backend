-- CP60.1 M2 rollback (on a database where 10_retire_storage.sql ran).
--
-- The authoritative rollback is restoring the protected backup taken before
-- M2 (npm run db:restore:verify proves it). This script is the in-place
-- alternative: it recreates the legacy enums, tables and keys as the
-- pre-M2 schema defined them and copies the archived rows back, then
-- requires the pre-M2 application build (Prisma models present).

BEGIN;

ALTER TYPE public."PayOSPaymentIntentType" ADD VALUE IF NOT EXISTS 'COURSE';
COMMIT;

BEGIN;

CREATE TYPE public."ClassStatus" AS ENUM ('UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED');
CREATE TYPE public."EnrollmentStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'DROPPED');
CREATE TYPE public."PaymentStatus" AS ENUM ('PENDING', 'REPORTED', 'CONFIRMED', 'REJECTED', 'REVIEW_REQUIRED');
CREATE TYPE public."PaymentActivationIssue" AS ENUM ('CLASS_FULL', 'CLASS_NOT_ELIGIBLE');
CREATE TYPE public."AssignmentType" AS ENUM ('ESSAY', 'QUIZ');

-- Table shapes are taken from the archive (same columns, enums as text),
-- then the enum columns are converted back and keys restored.
CREATE TABLE public."Class"                (LIKE legacy_archive."Class"                INCLUDING DEFAULTS);
CREATE TABLE public."Enrollment"           (LIKE legacy_archive."Enrollment"           INCLUDING DEFAULTS);
CREATE TABLE public."Payment"              (LIKE legacy_archive."Payment"              INCLUDING DEFAULTS);
CREATE TABLE public."Assignment"           (LIKE legacy_archive."Assignment"           INCLUDING DEFAULTS);
CREATE TABLE public."AssignmentSubmission" (LIKE legacy_archive."AssignmentSubmission" INCLUDING DEFAULTS);
CREATE TABLE public."Announcement"         (LIKE legacy_archive."Announcement"         INCLUDING DEFAULTS);
CREATE TABLE public."WatchTracking"        (LIKE legacy_archive."WatchTracking"        INCLUDING DEFAULTS);
CREATE TABLE public."UserBilling"          (LIKE legacy_archive."UserBilling"          INCLUDING DEFAULTS);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Class','Enrollment','Payment','Assignment','AssignmentSubmission','Announcement','WatchTracking','UserBilling']
  LOOP
    EXECUTE format('INSERT INTO public.%I SELECT * FROM legacy_archive.%I', t, t);
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN "archivedAt"', t);
    EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (id)', t);
  END LOOP;
END $$;

ALTER TABLE public."Class" ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public."ClassStatus" USING status::public."ClassStatus",
  ALTER COLUMN status SET DEFAULT 'UPCOMING';
ALTER TABLE public."Enrollment" ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public."EnrollmentStatus" USING status::public."EnrollmentStatus",
  ALTER COLUMN status SET DEFAULT 'ACTIVE';
ALTER TABLE public."Payment" ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public."PaymentStatus" USING status::public."PaymentStatus",
  ALTER COLUMN status SET DEFAULT 'PENDING',
  ALTER COLUMN "activationIssue" TYPE public."PaymentActivationIssue" USING "activationIssue"::public."PaymentActivationIssue";
ALTER TABLE public."Assignment" ALTER COLUMN type DROP DEFAULT,
  ALTER COLUMN type TYPE public."AssignmentType" USING type::public."AssignmentType",
  ALTER COLUMN type SET DEFAULT 'ESSAY';

ALTER TABLE public."Class" ADD CONSTRAINT "Class_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE UNIQUE INDEX "Class_courseId_name_key" ON public."Class"("courseId", name);
ALTER TABLE public."Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Enrollment" ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES public."Class"(id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE UNIQUE INDEX "Enrollment_userId_classId_key" ON public."Enrollment"("userId", "classId");
ALTER TABLE public."Payment" ADD CONSTRAINT "Payment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES public."Enrollment"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."Payment" ADD CONSTRAINT "Payment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE UNIQUE INDEX "Payment_enrollmentId_key" ON public."Payment"("enrollmentId");
CREATE UNIQUE INDEX "Payment_transferCode_key" ON public."Payment"("transferCode");
CREATE INDEX "Payment_status_createdAt_idx" ON public."Payment"(status, "createdAt");
CREATE INDEX "Payment_reviewedById_idx" ON public."Payment"("reviewedById");
ALTER TABLE public."Assignment" ADD CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES public."Class"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES public."Assignment"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_userId_key" ON public."AssignmentSubmission"("assignmentId", "userId");
ALTER TABLE public."Announcement" ADD CONSTRAINT "Announcement_classId_fkey" FOREIGN KEY ("classId") REFERENCES public."Class"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."WatchTracking" ADD CONSTRAINT "WatchTracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE UNIQUE INDEX "WatchTracking_userId_key" ON public."WatchTracking"("userId");
ALTER TABLE public."UserBilling" ADD CONSTRAINT "UserBilling_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE UNIQUE INDEX "UserBilling_userId_key" ON public."UserBilling"("userId");

-- Sequences: identity defaults came from the archive LIKE copy as nextval of
-- the dropped sequences; recreate them at the current maximum.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Class','Enrollment','Payment','Assignment','AssignmentSubmission','Announcement','WatchTracking','UserBilling']
  LOOP
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I OWNED BY public.%I.id', t || '_id_seq', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L)', t, 'public.' || quote_ident(t || '_id_seq'));
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT coalesce(max(id), 0) FROM public.%I), 1))', 'public.' || quote_ident(t || '_id_seq'), t);
  END LOOP;
END $$;

ALTER TABLE public."PayOSPaymentIntent" ADD COLUMN "coursePaymentId" integer;
INSERT INTO public."PayOSPaymentIntent"
  SELECT (jsonb_populate_record(null::public."PayOSPaymentIntent", to_jsonb(a) - 'archivedAt')).*
  FROM legacy_archive."PayOSPaymentIntent_course" a;
CREATE UNIQUE INDEX "PayOSPaymentIntent_coursePaymentId_key" ON public."PayOSPaymentIntent"("coursePaymentId");
ALTER TABLE public."PayOSPaymentIntent" ADD CONSTRAINT "PayOSPaymentIntent_coursePaymentId_fkey" FOREIGN KEY ("coursePaymentId") REFERENCES public."Payment"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

COMMIT;
