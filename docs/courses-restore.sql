-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'DROPPED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'REPORTED', 'CONFIRMED', 'REJECTED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PaymentActivationIssue" AS ENUM ('CLASS_FULL', 'CLASS_NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "CourseLessonStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "CourseLessonSectionType" AS ENUM ('INTRO', 'THEORY', 'EXAMPLE', 'TIP', 'COMMON_MISTAKE', 'STRATEGY', 'VOCABULARY', 'GRAMMAR', 'READING_TEXT', 'LISTENING_SCRIPT', 'SPEAKING_GUIDE', 'WRITING_GUIDE', 'CHECKPOINT', 'SUMMARY', 'REFERENCE');

-- CreateEnum
CREATE TYPE "CourseLessonExerciseType" AS ENUM ('MULTIPLE_CHOICE', 'MULTI_SELECT', 'FILL_IN_THE_BLANK', 'MATCHING', 'ORDERING', 'TRUE_FALSE', 'READING_COMPREHENSION', 'LISTENING_COMPREHENSION', 'VOCABULARY', 'GRAMMAR', 'SPEAKING_READ_ALOUD', 'SPEAKING_SHORT_RESPONSE', 'WRITING_SHORT_RESPONSE', 'WRITING_GUIDED', 'WRITING_EMAIL', 'TOEIC_STYLE', 'CHECKPOINT');

-- CreateEnum
CREATE TYPE "CourseLessonAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('ESSAY', 'QUIZ');

-- AlterEnum
ALTER TYPE "PlanFeatureKey" ADD VALUE 'COURSE_LIBRARY_ACCESS';

-- AlterEnum
ALTER TYPE "PayOSPaymentIntentType" ADD VALUE 'COURSE';

-- AlterEnum
ALTER TYPE "IssueReportArea" ADD VALUE 'COURSE';

-- AlterTable
ALTER TABLE "PayOSPaymentIntent" ADD COLUMN     "coursePaymentId" INTEGER;

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "courseId" INTEGER;

-- CreateTable
CREATE TABLE "UserBilling" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tuitionFee" JSONB,
    "bankQrUrl" TEXT,
    "bankName" TEXT,
    "bankBin" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "bankAccount" TEXT,

    CONSTRAINT "UserBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "level" TEXT,
    "curriculumType" TEXT NOT NULL DEFAULT 'GENERAL_ENGLISH',
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "capacity" INTEGER DEFAULT 30,
    "tuitionFeeVnd" INTEGER NOT NULL DEFAULT 0,
    "status" "ClassStatus" NOT NULL DEFAULT 'UPCOMING',

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "transferCode" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "activationIssue" "PaymentActivationIssue",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "adminNote" TEXT,
    "activationNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "videoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT,
    "objective" TEXT,
    "contentText" TEXT,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseActivity" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "quizId" INTEGER,
    "speakingPracticeSetId" TEXT,
    "toeicExamId" INTEGER,
    "grammarTopicId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLesson" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "learningObjectives" JSONB NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 15,
    "difficulty" TEXT,
    "coverImage" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "CourseLessonStatus" NOT NULL DEFAULT 'DRAFT',
    "requiresFinalCheck" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonSection" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "CourseLessonSectionType" NOT NULL,
    "heading" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CourseLessonSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonExercise" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "CourseLessonExerciseType" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "instructions" TEXT,
    "content" JSONB NOT NULL,
    "rubric" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "minimumScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLessonExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonQuestion" (
    "id" SERIAL NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "CourseLessonQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonReference" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT,
    "url" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "CourseLessonReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonMedia" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "provenance" TEXT,
    "renderStatus" TEXT NOT NULL DEFAULT 'READY',

    CONSTRAINT "CourseLessonMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "status" "CourseLessonAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "score" DOUBLE PRECISION,
    "maxScore" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLessonAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonExerciseAnswer" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "answer" JSONB NOT NULL,
    "isCorrect" BOOLEAN,
    "score" DOUBLE PRECISION,

    CONSTRAINT "CourseLessonExerciseAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "type" "AssignmentType" NOT NULL DEFAULT 'ESSAY',
    "quizData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "content" TEXT,
    "fileUrl" TEXT,
    "quizAnswers" JSONB,
    "grade" DOUBLE PRECISION,
    "feedback" TEXT,
    "isPointsAwarded" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" SERIAL NOT NULL,
    "classId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchTracking" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchTracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserBilling_userId_key" ON "UserBilling"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Class_courseId_name_key" ON "Class"("courseId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_userId_classId_key" ON "Enrollment"("userId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_enrollmentId_key" ON "Payment"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transferCode_key" ON "Payment"("transferCode");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_reviewedById_idx" ON "Payment"("reviewedById");

-- CreateIndex
CREATE INDEX "CourseActivity_courseId_isRequired_order_idx" ON "CourseActivity"("courseId", "isRequired", "order");

-- CreateIndex
CREATE INDEX "CourseActivity_quizId_idx" ON "CourseActivity"("quizId");

-- CreateIndex
CREATE INDEX "CourseActivity_speakingPracticeSetId_idx" ON "CourseActivity"("speakingPracticeSetId");

-- CreateIndex
CREATE INDEX "CourseActivity_toeicExamId_idx" ON "CourseActivity"("toeicExamId");

-- CreateIndex
CREATE INDEX "CourseActivity_grammarTopicId_idx" ON "CourseActivity"("grammarTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseActivity_lessonId_order_key" ON "CourseActivity"("lessonId", "order");

-- CreateIndex
CREATE INDEX "CourseLesson_courseId_status_order_idx" ON "CourseLesson"("courseId", "status", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLesson_courseId_slug_key" ON "CourseLesson"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLesson_courseId_order_key" ON "CourseLesson"("courseId", "order");

-- CreateIndex
CREATE INDEX "CourseLessonSection_lessonId_type_idx" ON "CourseLessonSection"("lessonId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLessonSection_lessonId_order_key" ON "CourseLessonSection"("lessonId", "order");

-- CreateIndex
CREATE INDEX "CourseLessonExercise_lessonId_required_order_idx" ON "CourseLessonExercise"("lessonId", "required", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLessonExercise_lessonId_slug_key" ON "CourseLessonExercise"("lessonId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLessonExercise_lessonId_order_key" ON "CourseLessonExercise"("lessonId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLessonQuestion_exerciseId_order_key" ON "CourseLessonQuestion"("exerciseId", "order");

-- CreateIndex
CREATE INDEX "CourseLessonReference_lessonId_idx" ON "CourseLessonReference"("lessonId");

-- CreateIndex
CREATE INDEX "CourseLessonMedia_lessonId_type_idx" ON "CourseLessonMedia"("lessonId", "type");

-- CreateIndex
CREATE INDEX "CourseLessonAttempt_userId_lessonId_exerciseId_status_idx" ON "CourseLessonAttempt"("userId", "lessonId", "exerciseId", "status");

-- CreateIndex
CREATE INDEX "CourseLessonAttempt_lessonId_exerciseId_status_idx" ON "CourseLessonAttempt"("lessonId", "exerciseId", "status");

-- CreateIndex
CREATE INDEX "CourseLessonExerciseAnswer_questionId_idx" ON "CourseLessonExerciseAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLessonExerciseAnswer_attemptId_questionId_key" ON "CourseLessonExerciseAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_userId_key" ON "AssignmentSubmission"("assignmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchTracking_userId_key" ON "WatchTracking"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayOSPaymentIntent_coursePaymentId_key" ON "PayOSPaymentIntent"("coursePaymentId");

-- AddForeignKey
ALTER TABLE "UserBilling" ADD CONSTRAINT "UserBilling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayOSPaymentIntent" ADD CONSTRAINT "PayOSPaymentIntent_coursePaymentId_fkey" FOREIGN KEY ("coursePaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_speakingPracticeSetId_fkey" FOREIGN KEY ("speakingPracticeSetId") REFERENCES "SpeakingPracticeSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_toeicExamId_fkey" FOREIGN KEY ("toeicExamId") REFERENCES "ToeicExamSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_grammarTopicId_fkey" FOREIGN KEY ("grammarTopicId") REFERENCES "GrammarTopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonSection" ADD CONSTRAINT "CourseLessonSection_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonExercise" ADD CONSTRAINT "CourseLessonExercise_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonQuestion" ADD CONSTRAINT "CourseLessonQuestion_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "CourseLessonExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonReference" ADD CONSTRAINT "CourseLessonReference_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonMedia" ADD CONSTRAINT "CourseLessonMedia_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonAttempt" ADD CONSTRAINT "CourseLessonAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonAttempt" ADD CONSTRAINT "CourseLessonAttempt_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonAttempt" ADD CONSTRAINT "CourseLessonAttempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "CourseLessonExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonExerciseAnswer" ADD CONSTRAINT "CourseLessonExerciseAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CourseLessonAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonExerciseAnswer" ADD CONSTRAINT "CourseLessonExerciseAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseLessonQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchTracking" ADD CONSTRAINT "WatchTracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

