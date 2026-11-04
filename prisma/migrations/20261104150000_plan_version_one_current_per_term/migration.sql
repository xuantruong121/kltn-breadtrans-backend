-- A paid plan now sells several terms (30, 90, 180 days), each with its own
-- current version. The guarantee stays at the database level, one step finer:
-- at most one catalog-current version per plan AND term. FREE has no term
-- (durationDays NULL), so NULL is folded to 0 to keep one current FREE version.
-- No row changes: today every plan has exactly one current version.
DROP INDEX "PlanVersion_one_current_per_plan_idx";

CREATE UNIQUE INDEX "PlanVersion_one_current_per_plan_term_idx"
  ON "PlanVersion"("planId", COALESCE("durationDays", 0))
  WHERE "isCurrent" = true;
