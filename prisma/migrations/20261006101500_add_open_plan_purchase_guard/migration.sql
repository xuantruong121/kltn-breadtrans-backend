CREATE UNIQUE INDEX "PlanPurchase_one_open_per_user_version_idx"
  ON "PlanPurchase"("userId", "planVersionId")
  WHERE "status" = 'PENDING_PAYMENT';
