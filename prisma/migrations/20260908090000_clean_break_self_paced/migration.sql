-- BreadTrans clean-break self-paced migration.
-- Generated/inspected manually from the contracted Prisma schema.
-- Apply only after empty-db and populated-backup rehearsals.

BEGIN;

-- 1. Remove Teacher/live foreign keys before dropping their columns/tables.
ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS "Course_teacherId_fkey";
ALTER TABLE "Class" DROP CONSTRAINT IF EXISTS "Class_teacherId_fkey";
ALTER TABLE "Attendance" DROP CONSTRAINT IF EXISTS "Attendance_sessionId_fkey";
ALTER TABLE "Attendance" DROP CONSTRAINT IF EXISTS "Attendance_userId_fkey";
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_classId_fkey";

-- 2. Remove live-only and Teacher ownership data structures.
DROP TABLE IF EXISTS "Attendance" CASCADE;
DROP TABLE IF EXISTS "Session" CASCADE;
DROP TABLE IF EXISTS "ClassAttendance" CASCADE;
DROP TABLE IF EXISTS "CurrencyRequest" CASCADE;

ALTER TABLE "Course" DROP COLUMN IF EXISTS "teacherId";
ALTER TABLE "Class" DROP COLUMN IF EXISTS "teacherId";
ALTER TABLE "Class" DROP COLUMN IF EXISTS "meetingLink";

-- 3. Remove existing Teacher identities after their ownership FKs are gone.
DELETE FROM "User" WHERE "role"::text = 'TEACHER';

-- 4. Normalize legacy Course workflow states before enum contraction.
UPDATE "Course"
SET "status" = 'DRAFT'
WHERE "status"::text IN ('PENDING_REVIEW', 'REJECTED');

-- 5. Contract Role to ADMIN/STUDENT.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
CREATE TYPE "Role_clean_break" AS ENUM ('ADMIN', 'STUDENT');
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role_clean_break"
  USING ("role"::text::"Role_clean_break");
DROP TYPE "Role";
ALTER TYPE "Role_clean_break" RENAME TO "Role";
ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'STUDENT'::"Role";

-- 6. Contract CourseStatus to DRAFT/PUBLISHED.
ALTER TABLE "Course" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "CourseStatus_clean_break" AS ENUM ('DRAFT', 'PUBLISHED');
ALTER TABLE "Course"
  ALTER COLUMN "status" TYPE "CourseStatus_clean_break"
  USING ("status"::text::"CourseStatus_clean_break");
DROP TYPE "CourseStatus";
ALTER TYPE "CourseStatus_clean_break" RENAME TO "CourseStatus";
ALTER TABLE "Course"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"CourseStatus";

COMMIT;

