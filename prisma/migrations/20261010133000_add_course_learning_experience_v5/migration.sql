-- Course Learning Experience 5.0: additive Course-owned lesson/exercise graph.
-- Legacy CourseActivity/Lesson data is intentionally preserved.
CREATE TYPE "CourseLessonStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "CourseLessonSectionType" AS ENUM ('INTRO', 'THEORY', 'EXAMPLE', 'TIP', 'COMMON_MISTAKE', 'STRATEGY', 'VOCABULARY', 'GRAMMAR', 'READING_TEXT', 'LISTENING_SCRIPT', 'SPEAKING_GUIDE', 'WRITING_GUIDE', 'CHECKPOINT', 'SUMMARY', 'REFERENCE');
CREATE TYPE "CourseLessonExerciseType" AS ENUM ('MULTIPLE_CHOICE', 'MULTI_SELECT', 'FILL_IN_THE_BLANK', 'MATCHING', 'ORDERING', 'TRUE_FALSE', 'READING_COMPREHENSION', 'LISTENING_COMPREHENSION', 'VOCABULARY', 'GRAMMAR', 'SPEAKING_READ_ALOUD', 'SPEAKING_SHORT_RESPONSE', 'WRITING_SHORT_RESPONSE', 'WRITING_GUIDED', 'WRITING_EMAIL', 'TOEIC_STYLE', 'CHECKPOINT');
CREATE TYPE "CourseLessonAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

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
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseLesson_pkey" PRIMARY KEY ("id")
);
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
CREATE TABLE "CourseLessonExerciseAnswer" (
  "id" SERIAL NOT NULL,
  "attemptId" INTEGER NOT NULL,
  "questionId" INTEGER NOT NULL,
  "answer" JSONB NOT NULL,
  "isCorrect" BOOLEAN,
  "score" DOUBLE PRECISION,
  CONSTRAINT "CourseLessonExerciseAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseLesson_courseId_slug_key" ON "CourseLesson"("courseId", "slug");
CREATE UNIQUE INDEX "CourseLesson_courseId_order_key" ON "CourseLesson"("courseId", "order");
CREATE INDEX "CourseLesson_courseId_status_order_idx" ON "CourseLesson"("courseId", "status", "order");
CREATE UNIQUE INDEX "CourseLessonSection_lessonId_order_key" ON "CourseLessonSection"("lessonId", "order");
CREATE INDEX "CourseLessonSection_lessonId_type_idx" ON "CourseLessonSection"("lessonId", "type");
CREATE UNIQUE INDEX "CourseLessonExercise_lessonId_slug_key" ON "CourseLessonExercise"("lessonId", "slug");
CREATE UNIQUE INDEX "CourseLessonExercise_lessonId_order_key" ON "CourseLessonExercise"("lessonId", "order");
CREATE INDEX "CourseLessonExercise_lessonId_required_order_idx" ON "CourseLessonExercise"("lessonId", "required", "order");
CREATE UNIQUE INDEX "CourseLessonQuestion_exerciseId_order_key" ON "CourseLessonQuestion"("exerciseId", "order");
CREATE INDEX "CourseLessonReference_lessonId_idx" ON "CourseLessonReference"("lessonId");
CREATE INDEX "CourseLessonMedia_lessonId_type_idx" ON "CourseLessonMedia"("lessonId", "type");
CREATE INDEX "CourseLessonAttempt_userId_lessonId_exerciseId_status_idx" ON "CourseLessonAttempt"("userId", "lessonId", "exerciseId", "status");
CREATE INDEX "CourseLessonAttempt_lessonId_exerciseId_status_idx" ON "CourseLessonAttempt"("lessonId", "exerciseId", "status");
CREATE UNIQUE INDEX "CourseLessonExerciseAnswer_attemptId_questionId_key" ON "CourseLessonExerciseAnswer"("attemptId", "questionId");
CREATE INDEX "CourseLessonExerciseAnswer_questionId_idx" ON "CourseLessonExerciseAnswer"("questionId");

ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonSection" ADD CONSTRAINT "CourseLessonSection_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonExercise" ADD CONSTRAINT "CourseLessonExercise_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonQuestion" ADD CONSTRAINT "CourseLessonQuestion_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "CourseLessonExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonReference" ADD CONSTRAINT "CourseLessonReference_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonMedia" ADD CONSTRAINT "CourseLessonMedia_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonAttempt" ADD CONSTRAINT "CourseLessonAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonAttempt" ADD CONSTRAINT "CourseLessonAttempt_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonAttempt" ADD CONSTRAINT "CourseLessonAttempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "CourseLessonExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonExerciseAnswer" ADD CONSTRAINT "CourseLessonExerciseAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CourseLessonAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonExerciseAnswer" ADD CONSTRAINT "CourseLessonExerciseAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseLessonQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
