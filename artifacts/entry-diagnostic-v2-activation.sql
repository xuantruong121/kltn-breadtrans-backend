-- Entry Diagnostic V2 activation: make id 5 the learner-facing assessment.
--
-- One transaction. Every guard must hold or nothing changes:
--   id 5 is the V2 source (DIAG_V2_ASSESSMENT), DRAFT, inactive, contentVersion 6,
--   all 10 listening clips active with a URL, id 1 is the current ACTIVE one.
-- The single-active index and the status/isActive check constraint are
-- respected by retiring id 1 to READY first. No attempt, question or result
-- row is touched; id 1 and its history stay intact for rollback.
-- Rollback: artifacts/entry-diagnostic-v2-activation-rollback.sql

BEGIN;

DO $$
DECLARE
  ok5 int;
  ok1 int;
  clips int;
BEGIN
  SELECT count(*) INTO ok5 FROM "DiagnosticAssessment"
   WHERE id = 5 AND "sourceKey" = 'DIAG_V2_ASSESSMENT' AND status = 'DRAFT'
     AND "isActive" = false AND "contentVersion" = 6
     AND "scoringVersion" = 'FOUR_SKILL_PLACEMENT_V2';
  SELECT count(*) INTO ok1 FROM "DiagnosticAssessment"
   WHERE id = 1 AND status = 'ACTIVE' AND "isActive" = true;
  SELECT count(*) INTO clips FROM "DiagnosticListeningClip" c
    JOIN "DiagnosticQuestion" q ON q.id = c."questionId"
   WHERE q."assessmentId" = 5 AND c."isActive" = true AND c.url IS NOT NULL
     AND c.url = q.options->>'audioUrl';
  IF ok5 <> 1 OR ok1 <> 1 OR clips <> 10 THEN
    RAISE EXCEPTION 'V2_ACTIVATION_ABORTED: id5=% id1=% clips=%', ok5, ok1, clips;
  END IF;
END $$;

UPDATE "DiagnosticAssessment" SET "isActive" = false, status = 'READY', "updatedAt" = now()
 WHERE id = 1 AND status = 'ACTIVE' AND "isActive" = true;
UPDATE "DiagnosticAssessment" SET "isActive" = true, status = 'ACTIVE', "updatedAt" = now()
 WHERE id = 5 AND status = 'DRAFT' AND "isActive" = false;

DO $$
BEGIN
  IF (SELECT count(*) FROM "DiagnosticAssessment" WHERE "isActive" = true) <> 1
     OR (SELECT id FROM "DiagnosticAssessment" WHERE "isActive" = true) <> 5 THEN
    RAISE EXCEPTION 'V2_ACTIVATION_ABORTED: id 5 is not the only active assessment';
  END IF;
END $$;

SELECT id, status, "isActive", "contentVersion" FROM "DiagnosticAssessment" WHERE id IN (1, 5) ORDER BY id;
COMMIT;
