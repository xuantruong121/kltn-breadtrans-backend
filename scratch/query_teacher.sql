SELECT c.id, c.name, c."teacherId", u.email, u.role 
FROM "Class" c 
JOIN "User" u ON c."teacherId" = u.id 
WHERE c.id = 36;
