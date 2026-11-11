-- Guided rewrite of a graded Writing practice answer: a revision is a new
-- Submission that points at the first submission of its chain. Additive:
-- existing rows keep NULL and behave as before.
ALTER TABLE "Submission" ADD COLUMN "revisionOfId" INTEGER;

CREATE INDEX "Submission_revisionOfId_idx" ON "Submission"("revisionOfId");

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_revisionOfId_fkey"
  FOREIGN KEY ("revisionOfId") REFERENCES "Submission"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
