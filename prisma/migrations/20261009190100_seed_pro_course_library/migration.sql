DO $$
DECLARE
  pro_id INTEGER;
  current_version INTEGER;
BEGIN
  SELECT id INTO pro_id FROM "Plan" WHERE code = 'PRO';
  IF pro_id IS NULL THEN
    INSERT INTO "Plan" (code, "displayName", description, status, "updatedAt")
    VALUES ('PRO', 'BreadTrans Pro', 'Toàn bộ tự học nâng cao và thư viện khóa học.', 'ACTIVE', CURRENT_TIMESTAMP)
    RETURNING id INTO pro_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "PlanVersion"
    WHERE "planId" = pro_id AND "priceVnd" = 149000 AND "durationDays" = 30
      AND status = 'PUBLISHED' AND "isCurrent" = true
  ) THEN
    UPDATE "PlanVersion"
    SET "isCurrent" = false,
        status = CASE WHEN status = 'PUBLISHED' THEN 'RETIRED'::"PlanVersionStatus" ELSE status END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "planId" = pro_id AND "isCurrent" = true;

    SELECT COALESCE(MAX(version), 0) + 1 INTO current_version
    FROM "PlanVersion" WHERE "planId" = pro_id;

    INSERT INTO "PlanVersion" (
      "planId", version, "displayName", description, "durationDays", "priceVnd",
      currency, status, "isCurrent", "effectiveFrom", "publishedAt", "createdAt", "updatedAt"
    ) VALUES (
      pro_id, current_version, 'BreadTrans Pro',
      'Tất cả quyền lợi Plus và toàn bộ khóa học tự học đã sẵn sàng.',
      30, 149000, 'VND', 'PUBLISHED', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  END IF;

  INSERT INTO "PlanEntitlement" ("planVersionId", "featureKey", enabled, unit, "createdAt", "updatedAt")
  SELECT id, 'COURSE_LIBRARY_ACCESS'::"PlanFeatureKey", true, 'CONTENT_ACCESS'::"EntitlementUnit", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "PlanVersion"
  WHERE "planId" = pro_id AND "priceVnd" = 149000 AND "durationDays" = 30
    AND status = 'PUBLISHED' AND "isCurrent" = true
    AND NOT EXISTS (
      SELECT 1 FROM "PlanEntitlement" pe
      WHERE pe."planVersionId" = "PlanVersion".id
        AND pe."featureKey" = 'COURSE_LIBRARY_ACCESS'::"PlanFeatureKey"
    );
END $$;

UPDATE "Course" c
SET status = 'DRAFT'::"CourseStatus", "updatedAt" = CURRENT_TIMESTAMP
WHERE c.status = 'PUBLISHED'
  AND NOT EXISTS (SELECT 1 FROM "CourseActivity" a WHERE a."courseId" = c.id);
