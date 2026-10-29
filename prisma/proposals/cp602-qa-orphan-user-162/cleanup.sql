-- CP60.2 — remove the QA fixture left in kltn_db by the CP60.1 incident.
--
-- NOT APPROVED FOR kltn_db. Running it there needs a separate owner decision,
-- a fresh restore-verified backup, and the session setting below:
--
--   SET breadtrans.cp602_cleanup = 'owner-approved';
--   \i cleanup.sql
--
-- Manifest (reviewed read-only on kltn_db, 2026-10-28):
--   User 162                email qa-global-a-a2314ca6-7087-4a63-8c43-c1d5dd00c28e@breadtrans.local
--                           role STUDENT, createdAt 2026-10-28 10:30:44.021 (UTC)
--   Profile 244             userId 162, fullName 'QA global audit PLUS'   (cascade)
--   UserPet 127             userId 162                                      (cascade)
--   Subscription 220        userId 162, PLUS, planPurchaseId NULL, 0 events (RESTRICT: deleted first)
-- No other row references user 162 (all foreign keys to "User" and every
-- integer *userId / studentId / actorId column were checked).
--
-- Idempotent: if user 162 is already gone, it reports that and changes nothing.
-- Fail-closed: any difference from the manifest aborts the transaction.

BEGIN;

DO $$
DECLARE
  r record;
  n bigint;
  unexpected text := '';
BEGIN
  IF coalesce(current_setting('breadtrans.cp602_cleanup', true), '') <> 'owner-approved' THEN
    RAISE EXCEPTION 'refused: SET breadtrans.cp602_cleanup = ''owner-approved'' first (owner decision required)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "User" WHERE id = 162) THEN
    IF EXISTS (SELECT 1 FROM "Subscription" WHERE id = 220) THEN
      RAISE EXCEPTION 'manifest mismatch: user 162 is gone but subscription 220 exists';
    END IF;
    RAISE NOTICE 'already clean: user 162 and subscription 220 do not exist';
    RETURN;
  END IF;

  -- The exact identity of every row in the manifest.
  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE id = 162
      AND email = 'qa-global-a-a2314ca6-7087-4a63-8c43-c1d5dd00c28e@breadtrans.local'
      AND role::text = 'STUDENT'
      AND "createdAt" = '2026-10-28 10:30:44.021'
  ) THEN RAISE EXCEPTION 'manifest mismatch: user 162 identity differs'; END IF;

  IF (SELECT count(*) FROM "Profile" WHERE "userId" = 162) <> 1
     OR NOT EXISTS (SELECT 1 FROM "Profile" WHERE id = 244 AND "userId" = 162 AND "fullName" = 'QA global audit PLUS')
  THEN RAISE EXCEPTION 'manifest mismatch: profile'; END IF;

  IF (SELECT count(*) FROM "UserPet" WHERE "userId" = 162) <> 1
     OR NOT EXISTS (SELECT 1 FROM "UserPet" WHERE id = 127 AND "userId" = 162)
  THEN RAISE EXCEPTION 'manifest mismatch: pet'; END IF;

  IF (SELECT count(*) FROM "Subscription" WHERE "userId" = 162) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM "Subscription" s
       JOIN "PlanVersion" pv ON pv.id = s."planVersionId"
       JOIN "Plan" p ON p.id = pv."planId"
       WHERE s.id = 220 AND s."userId" = 162 AND s."planPurchaseId" IS NULL AND p.code = 'PLUS'
     )
     OR EXISTS (SELECT 1 FROM "SubscriptionEvent" WHERE "subscriptionId" = 220)
  THEN RAISE EXCEPTION 'manifest mismatch: subscription'; END IF;

  -- Nothing else may reference the user.
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public."User"'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = 162', r.tbl, r.col) INTO n;
    IF n > 0 AND r.tbl::text NOT IN ('"Profile"', '"UserPet"', '"Subscription"') THEN
      unexpected := unexpected || format('%s.%s=%s ', r.tbl, r.col, n);
    END IF;
  END LOOP;
  IF unexpected <> '' THEN
    RAISE EXCEPTION 'manifest mismatch: unexpected references %', unexpected;
  END IF;

  DELETE FROM "Subscription" WHERE id = 220 AND "userId" = 162;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 subscription deleted, got %', n; END IF;

  DELETE FROM "User"
  WHERE id = 162 AND email = 'qa-global-a-a2314ca6-7087-4a63-8c43-c1d5dd00c28e@breadtrans.local';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 user deleted, got %', n; END IF;

  IF EXISTS (SELECT 1 FROM "Profile" WHERE "userId" = 162)
     OR EXISTS (SELECT 1 FROM "UserPet" WHERE "userId" = 162) THEN
    RAISE EXCEPTION 'cascade did not remove profile/pet';
  END IF;
  RAISE NOTICE 'removed: subscription 220, user 162 (+ profile 244, pet 127 by cascade)';
END $$;

COMMIT;
