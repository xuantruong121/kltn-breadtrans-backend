-- Phase C3 - prepared correction for C2-FIND-001.
--
-- STATUS: PREPARED. NOT EXECUTED against kltn_db in C3. It must not be run
-- without an explicit authorization naming this file.
--
-- Defect: the V2 importer did not write contentVersion, so the imported
-- Entry Diagnostic assessment (live id 5) kept the schema default 1 while its
-- content is the approved version 6. The importer is fixed in C3; this
-- statement corrects the one existing row without re-importing anything.
--
-- Every guard must hold or nothing changes:
--   id 5, the V2 source identity, still at the wrong version 1,
--   still an inactive DRAFT (an activated row is out of scope for this fix).
-- It touches no other column except updatedAt, no other row, no question.
--
-- Expected result: UPDATE 1 and one RETURNING row (5, 6). If the row count is
-- anything else, the transaction is rolled back by the DO block below.
-- Re-running after success changes nothing (UPDATE 0, then rollback).
--
-- Rehearsed in C3 on a disposable PostgreSQL 15 clone only: see
-- artifacts/c3-evidence/content-version-sql-rehearsal.log.

BEGIN;

CREATE TEMP TABLE c3_cv_fix ON COMMIT DROP AS
WITH changed AS (
  UPDATE "DiagnosticAssessment"
     SET "contentVersion" = 6,
         "updatedAt" = now()
   WHERE id = 5
     AND "sourceKey" = 'DIAG_V2_ASSESSMENT'
     AND "contentVersion" = 1
     AND status = 'DRAFT'
     AND "isActive" = false
  RETURNING id, "contentVersion"
)
SELECT * FROM changed;

SELECT * FROM c3_cv_fix;

DO $$
BEGIN
  IF (SELECT count(*) FROM c3_cv_fix) <> 1 THEN
    RAISE EXCEPTION 'C3_CONTENT_VERSION_FIX_ABORTED: expected exactly 1 row, got %',
      (SELECT count(*) FROM c3_cv_fix);
  END IF;
END $$;

COMMIT;
