SELECT 
  c.id, 
  c.name, 
  c.capacity, 
  c."tuitionFeeVnd", 
  c.status, 
  (SELECT count(*) FROM "Enrollment" e WHERE e."classId" = c.id AND e.status = 'ACTIVE') as active_count, 
  (SELECT count(*) FROM "Enrollment" e WHERE e."classId" = c.id AND e.status = 'PENDING_PAYMENT') as pending_count 
FROM "Class" c 
ORDER BY c.id;
