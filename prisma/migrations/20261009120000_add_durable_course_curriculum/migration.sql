ALTER TABLE "Course" ADD COLUMN "curriculumType" TEXT NOT NULL DEFAULT 'GENERAL_ENGLISH';

ALTER TABLE "Material" ADD COLUMN "objective" TEXT;
ALTER TABLE "Material" ADD COLUMN "contentText" TEXT;

CREATE TABLE "SpeakingPracticeSet" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpeakingPracticeSet_pkey" PRIMARY KEY ("id")
);

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseActivity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SpeakingExercise" ADD COLUMN "practiceSetId" TEXT;

CREATE UNIQUE INDEX "CourseActivity_lessonId_order_key" ON "CourseActivity"("lessonId", "order");
CREATE INDEX "CourseActivity_courseId_isRequired_order_idx" ON "CourseActivity"("courseId", "isRequired", "order");
CREATE INDEX "CourseActivity_quizId_idx" ON "CourseActivity"("quizId");
CREATE INDEX "CourseActivity_speakingPracticeSetId_idx" ON "CourseActivity"("speakingPracticeSetId");
CREATE INDEX "SpeakingExercise_practiceSetId_idx" ON "SpeakingExercise"("practiceSetId");

ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseActivity" ADD CONSTRAINT "CourseActivity_speakingPracticeSetId_fkey" FOREIGN KEY ("speakingPracticeSetId") REFERENCES "SpeakingPracticeSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpeakingExercise" ADD CONSTRAINT "SpeakingExercise_practiceSetId_fkey" FOREIGN KEY ("practiceSetId") REFERENCES "SpeakingPracticeSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
