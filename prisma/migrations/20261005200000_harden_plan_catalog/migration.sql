-- Additive catalog hardening. Existing business tables and data are untouched.
ALTER TABLE "PlanVersion"
  ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlanVersion"
  ADD CONSTRAINT "PlanVersion_version_positive"
  CHECK ("version" > 0);

CREATE INDEX "PlanVersion_planId_isCurrent_status_idx"
  ON "PlanVersion"("planId", "isCurrent", "status");

-- At most one catalog-current version may exist for a plan.
CREATE UNIQUE INDEX "PlanVersion_one_current_per_plan_idx"
  ON "PlanVersion"("planId")
  WHERE "isCurrent" = true;
