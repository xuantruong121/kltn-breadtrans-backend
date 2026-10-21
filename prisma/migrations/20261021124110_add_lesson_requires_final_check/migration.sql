-- Lesson-level flag: whether this lesson must have a scored Final Check
-- exercise before it can pass validation/publish. Additive, non-destructive,
-- defaults to true to preserve current behavior for existing lessons.
ALTER TABLE "CourseLesson" ADD COLUMN "requiresFinalCheck" BOOLEAN NOT NULL DEFAULT true;
