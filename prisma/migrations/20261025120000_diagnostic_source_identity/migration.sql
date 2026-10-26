-- Stable authored source identity for the canonical Entry Diagnostic importer.
--
-- Purely additive: three nullable columns and three unique indexes. No column
-- is dropped, no type changed, no row rewritten. Every existing row keeps NULL,
-- and Postgres treats each NULL as distinct in a unique index, so legacy V1
-- content cannot collide and needs no backfill.
--
-- These keys carry the authored draftKey (LST_Q_001, RDG_PASSAGE_02,
-- DIAG_V2_ASSESSMENT) so a re-import matches on authored identity rather than
-- on mutable question text or on (assessmentId, order).
--
-- Rubrics and listening clips deliberately get NO new column: they already have
-- sufficient identity via @@unique([skill, rubricVersion]) and
-- @@unique([questionId, version]).

ALTER TABLE "DiagnosticAssessment" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "DiagnosticQuestion" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "DiagnosticReadingPassage" ADD COLUMN "sourceKey" TEXT;

CREATE UNIQUE INDEX "DiagnosticAssessment_sourceKey_key"
  ON "DiagnosticAssessment"("sourceKey");

CREATE UNIQUE INDEX "DiagnosticQuestion_assessmentId_sourceKey_key"
  ON "DiagnosticQuestion"("assessmentId", "sourceKey");

CREATE UNIQUE INDEX "DiagnosticReadingPassage_assessmentId_sourceKey_key"
  ON "DiagnosticReadingPassage"("assessmentId", "sourceKey");
