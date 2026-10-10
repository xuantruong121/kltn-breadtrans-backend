-- PRO includes the published PLUS content entitlements in addition to its
-- COURSE_LIBRARY_ACCESS entitlement. Keep this additive and idempotent so
-- existing subscriptions and plan history remain untouched.
INSERT INTO "PlanEntitlement" ("planVersionId", "featureKey", enabled, "unit", "createdAt", "updatedAt")
SELECT pv.id, feature.feature_key::"PlanFeatureKey", true, 'CONTENT_ACCESS'::"EntitlementUnit", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "PlanVersion" pv
JOIN "Plan" p ON p.id = pv."planId"
CROSS JOIN (VALUES
  ('PREMIUM_VOCAB'),
  ('PREMIUM_READING'),
  ('PREMIUM_LISTENING'),
  ('PREMIUM_SPEAKING_CONTENT'),
  ('PREMIUM_WRITING_CONTENT')
) AS feature(feature_key)
WHERE p.code = 'PRO'
  AND pv.status = 'PUBLISHED'::"PlanVersionStatus"
  AND pv."isCurrent" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "PlanEntitlement" existing
    WHERE existing."planVersionId" = pv.id
      AND existing."featureKey" = feature.feature_key::"PlanFeatureKey"
  );
