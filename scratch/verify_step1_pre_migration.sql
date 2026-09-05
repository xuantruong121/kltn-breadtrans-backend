-- Step 1: Ensure column does not exist (Pre-Phase-3B State)
ALTER TABLE "Class" DROP COLUMN IF EXISTS "tuitionFeeVnd";

-- Insert prerequisite teacher & course
INSERT INTO "User" (id, email, password, role, "createdAt", "updatedAt")
VALUES (9001, 'pre_mig_teacher@test.com', 'hashed_pw', 'TEACHER', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Course" (id, title, description, level, "teacherId", status, "createdAt", "updatedAt")
VALUES (9001, 'Pre-Migration Course', 'Testing migration backfill', 'BEGINNER', 9001, 'PUBLISHED', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Step 2: Insert pre-existing Class rows WITHOUT tuitionFeeVnd
INSERT INTO "Class" (id, "courseId", "teacherId", name, "startDate", "endDate", "meetingLink", capacity, status)
VALUES 
  (9001, 9001, 9001, 'Pre-Mig Class 1', NOW(), NOW() + INTERVAL '30 days', 'https://meet.google.com/test-1', 25, 'UPCOMING'),
  (9002, 9001, 9001, 'Pre-Mig Class 2', NOW(), NOW() + INTERVAL '30 days', 'https://meet.google.com/test-2', 30, 'ONGOING'),
  (9003, 9001, 9001, 'Pre-Mig Class 3', NOW() - INTERVAL '60 days', NOW() - INTERVAL '30 days', 'https://meet.google.com/test-3', 20, 'COMPLETED')
ON CONFLICT (id) DO NOTHING;

-- Step 3: Verify tuitionFeeVnd does NOT exist yet in information_schema
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'Class' AND column_name = 'tuitionFeeVnd';
