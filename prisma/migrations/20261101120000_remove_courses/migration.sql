-- Remove courses, classes and tuition (GVHD decision, 2026-11-01).
-- Restore guide: docs/courses-restore.md

-- The enum change below fails while this row exists.
DELETE FROM "PlanEntitlement" WHERE "featureKey" = 'COURSE_LIBRARY_ACCESS';

-- AlterEnum
BEGIN;
CREATE TYPE "PayOSPaymentIntentType_new" AS ENUM ('PLAN');
ALTER TABLE "PayOSPaymentIntent" ALTER COLUMN "type" TYPE "PayOSPaymentIntentType_new" USING ("type"::text::"PayOSPaymentIntentType_new");
ALTER TYPE "PayOSPaymentIntentType" RENAME TO "PayOSPaymentIntentType_old";
ALTER TYPE "PayOSPaymentIntentType_new" RENAME TO "PayOSPaymentIntentType";
DROP TYPE "PayOSPaymentIntentType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PlanFeatureKey_new" AS ENUM ('AI_SPEAKING_ASSESSMENT', 'AI_WRITING_REVIEW', 'AI_TUTOR_MESSAGE', 'AI_EXPLANATION', 'PREMIUM_VOCAB', 'PREMIUM_READING', 'PREMIUM_LISTENING', 'PREMIUM_SPEAKING_CONTENT', 'PREMIUM_WRITING_CONTENT');
ALTER TABLE "PlanEntitlement" ALTER COLUMN "featureKey" TYPE "PlanFeatureKey_new" USING ("featureKey"::text::"PlanFeatureKey_new");
ALTER TYPE "PlanFeatureKey" RENAME TO "PlanFeatureKey_old";
ALTER TYPE "PlanFeatureKey_new" RENAME TO "PlanFeatureKey";
DROP TYPE "PlanFeatureKey_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_classId_fkey";

-- DropForeignKey
ALTER TABLE "Assignment" DROP CONSTRAINT "Assignment_classId_fkey";

-- DropForeignKey
ALTER TABLE "AssignmentSubmission" DROP CONSTRAINT "AssignmentSubmission_assignmentId_fkey";

-- DropForeignKey
ALTER TABLE "AssignmentSubmission" DROP CONSTRAINT "AssignmentSubmission_userId_fkey";

-- DropForeignKey
ALTER TABLE "Class" DROP CONSTRAINT "Class_courseId_fkey";

-- DropForeignKey
ALTER TABLE "CourseActivity" DROP CONSTRAINT "CourseActivity_courseId_fkey";

-- DropForeignKey
ALTER TABLE "CourseActivity" DROP CONSTRAINT "CourseActivity_grammarTopicId_fkey";

-- DropForeignKey
ALTER TABLE "CourseActivity" DROP CONSTRAINT "CourseActivity_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "CourseActivity" DROP CONSTRAINT "CourseActivity_quizId_fkey";

-- DropForeignKey
ALTER TABLE "CourseActivity" DROP CONSTRAINT "CourseActivity_speakingPracticeSetId_fkey";

-- DropForeignKey
ALTER TABLE "CourseActivity" DROP CONSTRAINT "CourseActivity_toeicExamId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLesson" DROP CONSTRAINT "CourseLesson_courseId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonAttempt" DROP CONSTRAINT "CourseLessonAttempt_exerciseId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonAttempt" DROP CONSTRAINT "CourseLessonAttempt_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonAttempt" DROP CONSTRAINT "CourseLessonAttempt_userId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonExercise" DROP CONSTRAINT "CourseLessonExercise_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonExerciseAnswer" DROP CONSTRAINT "CourseLessonExerciseAnswer_attemptId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonExerciseAnswer" DROP CONSTRAINT "CourseLessonExerciseAnswer_questionId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonMedia" DROP CONSTRAINT "CourseLessonMedia_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonQuestion" DROP CONSTRAINT "CourseLessonQuestion_exerciseId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonReference" DROP CONSTRAINT "CourseLessonReference_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "CourseLessonSection" DROP CONSTRAINT "CourseLessonSection_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_classId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_userId_fkey";

-- DropForeignKey
ALTER TABLE "Lesson" DROP CONSTRAINT "Lesson_courseId_fkey";

-- DropForeignKey
ALTER TABLE "Material" DROP CONSTRAINT "Material_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "PayOSPaymentIntent" DROP CONSTRAINT "PayOSPaymentIntent_coursePaymentId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_enrollmentId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "Quiz" DROP CONSTRAINT "Quiz_courseId_fkey";

-- DropForeignKey
ALTER TABLE "UserBilling" DROP CONSTRAINT "UserBilling_userId_fkey";

-- DropForeignKey
ALTER TABLE "WatchTracking" DROP CONSTRAINT "WatchTracking_userId_fkey";

-- DropIndex
DROP INDEX "PayOSPaymentIntent_coursePaymentId_key";

-- AlterTable
ALTER TABLE "PayOSPaymentIntent" DROP COLUMN "coursePaymentId";

-- AlterTable
ALTER TABLE "Quiz" DROP COLUMN "courseId";

-- DropTable
DROP TABLE "Announcement";

-- DropTable
DROP TABLE "Assignment";

-- DropTable
DROP TABLE "AssignmentSubmission";

-- DropTable
DROP TABLE "Class";

-- DropTable
DROP TABLE "Course";

-- DropTable
DROP TABLE "CourseActivity";

-- DropTable
DROP TABLE "CourseLesson";

-- DropTable
DROP TABLE "CourseLessonAttempt";

-- DropTable
DROP TABLE "CourseLessonExercise";

-- DropTable
DROP TABLE "CourseLessonExerciseAnswer";

-- DropTable
DROP TABLE "CourseLessonMedia";

-- DropTable
DROP TABLE "CourseLessonQuestion";

-- DropTable
DROP TABLE "CourseLessonReference";

-- DropTable
DROP TABLE "CourseLessonSection";

-- DropTable
DROP TABLE "Enrollment";

-- DropTable
DROP TABLE "Lesson";

-- DropTable
DROP TABLE "Material";

-- DropTable
DROP TABLE "Payment";

-- DropTable
DROP TABLE "UserBilling";

-- DropTable
DROP TABLE "WatchTracking";

-- DropEnum
DROP TYPE "AssignmentType";

-- DropEnum
DROP TYPE "ClassStatus";

-- DropEnum
DROP TYPE "CourseLessonAttemptStatus";

-- DropEnum
DROP TYPE "CourseLessonExerciseType";

-- DropEnum
DROP TYPE "CourseLessonSectionType";

-- DropEnum
DROP TYPE "CourseLessonStatus";

-- DropEnum
DROP TYPE "CourseStatus";

-- DropEnum
DROP TYPE "EnrollmentStatus";

-- DropEnum
DROP TYPE "PaymentActivationIssue";

-- DropEnum
DROP TYPE "PaymentStatus";

