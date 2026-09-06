INSERT INTO "Class" (id, "courseId", "teacherId", name, "startDate", "endDate", "meetingLink", capacity, "tuitionFeeVnd", status)
VALUES (37, 20, 41, 'Lớp Giao Tiếp K05 Semantics Test', NOW() + INTERVAL '5 days', NOW() + INTERVAL '35 days', 'https://meet.google.com/test-k05', 10, 350000, 'UPCOMING')
ON CONFLICT (id) DO UPDATE SET 
  capacity = 10, 
  "tuitionFeeVnd" = 350000, 
  status = 'UPCOMING';

DELETE FROM "Enrollment" WHERE "classId" = 37;

INSERT INTO "Enrollment" ("userId", "classId", "progress", status)
VALUES 
  (45, 37, 0, 'ACTIVE'),
  (46, 37, 0, 'ACTIVE'),
  (47, 37, 0, 'PENDING_PAYMENT'),
  (48, 37, 0, 'PENDING_PAYMENT'),
  (49, 37, 0, 'PENDING_PAYMENT'),
  (50, 37, 0, 'PENDING_PAYMENT'),
  (51, 37, 0, 'PENDING_PAYMENT');

-- Verification
SELECT 
  c.id, 
  c.name, 
  c.capacity, 
  c."tuitionFeeVnd", 
  c.status, 
  (SELECT count(*) FROM "Enrollment" e WHERE e."classId" = c.id AND e.status = 'ACTIVE') as active_count, 
  (SELECT count(*) FROM "Enrollment" e WHERE e."classId" = c.id AND e.status = 'PENDING_PAYMENT') as pending_count 
FROM "Class" c 
WHERE c.id IN (36, 37);
