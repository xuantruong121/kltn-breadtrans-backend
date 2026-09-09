-- Remove legacy live/Firestore fields that have no active consumers.
-- Course Offering identity, enrollment, payment, and self-paced progress remain intact.
ALTER TABLE "Class"
DROP COLUMN "links",
DROP COLUMN "noteProcess",
DROP COLUMN "pendingEvaluations",
DROP COLUMN "rank",
DROP COLUMN "stories",
DROP COLUMN "summary";

DROP TABLE "SpeakingEvalRetry";
