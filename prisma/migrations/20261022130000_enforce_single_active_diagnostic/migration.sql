-- A learner-facing diagnostic has exactly one active version. Keep Entry
-- Diagnostic v2 (id 2) when present; otherwise retain the newest active row.
WITH active_winner AS (
  SELECT "id"
  FROM "DiagnosticAssessment"
  WHERE "isActive" = true
  ORDER BY CASE WHEN "id" = 2 THEN 0 ELSE 1 END, "id" DESC
  LIMIT 1
)
UPDATE "DiagnosticAssessment"
SET "isActive" = false
WHERE "isActive" = true
  AND "id" NOT IN (SELECT "id" FROM active_winner);

CREATE UNIQUE INDEX "DiagnosticAssessment_single_active_key"
  ON "DiagnosticAssessment" (("isActive"))
  WHERE "isActive" = true;
