-- Verification 1: Column Schema Metadata
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default 
FROM information_schema.columns 
WHERE table_name = 'Class' AND column_name = 'tuitionFeeVnd';

-- Verification 2: Pre-existing Class rows received backfill 0
SELECT 
  id, 
  name, 
  capacity, 
  status, 
  "tuitionFeeVnd" 
FROM "Class" 
WHERE id IN (9001, 9002, 9003)
ORDER BY id;

-- Verification 3: New Class row without explicit tuitionFeeVnd receives DEFAULT 0
INSERT INTO "Class" (id, "courseId", "teacherId", name, "startDate", "endDate", "meetingLink", capacity, status)
VALUES (9004, 9001, 9001, 'Post-Mig Class Default', NOW(), NOW() + INTERVAL '30 days', 'https://meet.google.com/test-4', 20, 'UPCOMING')
ON CONFLICT (id) DO NOTHING;

SELECT 
  id, 
  name, 
  capacity, 
  status, 
  "tuitionFeeVnd" 
FROM "Class" 
WHERE id = 9004;
