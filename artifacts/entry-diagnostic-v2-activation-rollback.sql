-- Rollback of entry-diagnostic-v2-activation.sql: id 1 learner-facing again.
-- V2 attempts already made stay stored and readable; nothing is deleted.
BEGIN;
UPDATE "DiagnosticAssessment" SET "isActive" = false, status = 'DRAFT', "updatedAt" = now()
 WHERE id = 5 AND status = 'ACTIVE' AND "isActive" = true;
UPDATE "DiagnosticAssessment" SET "isActive" = true, status = 'ACTIVE', "updatedAt" = now()
 WHERE id = 1 AND status = 'READY' AND "isActive" = false;
DO $$
BEGIN
  IF (SELECT id FROM "DiagnosticAssessment" WHERE "isActive" = true) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'V2_ROLLBACK_ABORTED: id 1 is not the active assessment';
  END IF;
END $$;
SELECT id, status, "isActive" FROM "DiagnosticAssessment" WHERE id IN (1, 5) ORDER BY id;
COMMIT;
