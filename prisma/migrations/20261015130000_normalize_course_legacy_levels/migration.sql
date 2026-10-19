-- Normalize the only legacy Course level vocabulary into the authoritative
-- learner/admin contract. The predicate makes this migration idempotent.
UPDATE "Course"
SET "level" = 'BEGINNER'
WHERE "level" = 'A1-A2';
