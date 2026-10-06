ALTER TABLE "PlanPurchase"
  ADD CONSTRAINT "PlanPurchase_currency_nonempty"
  CHECK (length(btrim("currency")) > 0);

ALTER TABLE "PlanPayment"
  ADD CONSTRAINT "PlanPayment_currency_nonempty"
  CHECK (length(btrim("currency")) > 0);
