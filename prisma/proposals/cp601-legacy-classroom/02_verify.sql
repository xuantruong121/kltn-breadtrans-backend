-- CP60.1 M1 reconciliation (read-only). Every line must report match = t.
-- Compares row counts and an order-independent content digest of each public
-- table with its archive copy (archivedAt excluded, enums compared as text).

WITH pairs(name, pub, arc) AS (
  VALUES
    ('Class',                (SELECT count(*) FROM public."Class"),                (SELECT count(*) FROM legacy_archive."Class")),
    ('Enrollment',           (SELECT count(*) FROM public."Enrollment"),           (SELECT count(*) FROM legacy_archive."Enrollment")),
    ('Payment',              (SELECT count(*) FROM public."Payment"),              (SELECT count(*) FROM legacy_archive."Payment")),
    ('Assignment',           (SELECT count(*) FROM public."Assignment"),           (SELECT count(*) FROM legacy_archive."Assignment")),
    ('AssignmentSubmission', (SELECT count(*) FROM public."AssignmentSubmission"), (SELECT count(*) FROM legacy_archive."AssignmentSubmission")),
    ('Announcement',         (SELECT count(*) FROM public."Announcement"),         (SELECT count(*) FROM legacy_archive."Announcement")),
    ('WatchTracking',        (SELECT count(*) FROM public."WatchTracking"),        (SELECT count(*) FROM legacy_archive."WatchTracking")),
    ('UserBilling',          (SELECT count(*) FROM public."UserBilling"),          (SELECT count(*) FROM legacy_archive."UserBilling")),
    ('PayOSPaymentIntent COURSE',
      (SELECT count(*) FROM public."PayOSPaymentIntent" WHERE type::text = 'COURSE'),
      (SELECT count(*) FROM legacy_archive."PayOSPaymentIntent_course"))
)
SELECT 'count' AS kind, name, pub, arc, pub = arc AS match FROM pairs;

-- Content digest: md5 over the sorted JSON of every row, without archivedAt.
SELECT 'digest' AS kind, t AS name,
  (SELECT md5(coalesce(string_agg(x, '|' ORDER BY x), '')) FROM (
     SELECT (to_jsonb(p))::text AS x FROM public."Class" p WHERE t = 'Class'
     UNION ALL SELECT (to_jsonb(p))::text FROM public."Enrollment" p WHERE t = 'Enrollment'
     UNION ALL SELECT (to_jsonb(p))::text FROM public."Assignment" p WHERE t = 'Assignment'
     UNION ALL SELECT (to_jsonb(p))::text FROM public."AssignmentSubmission" p WHERE t = 'AssignmentSubmission'
     UNION ALL SELECT (to_jsonb(p))::text FROM public."Announcement" p WHERE t = 'Announcement'
     UNION ALL SELECT (to_jsonb(p))::text FROM public."WatchTracking" p WHERE t = 'WatchTracking'
     UNION ALL SELECT (to_jsonb(p))::text FROM public."UserBilling" p WHERE t = 'UserBilling'
     UNION ALL SELECT (to_jsonb(p))::text FROM public."Payment" p WHERE t = 'Payment') s)
  =
  (SELECT md5(coalesce(string_agg(x, '|' ORDER BY x), '')) FROM (
     SELECT (to_jsonb(a) - 'archivedAt')::text AS x FROM legacy_archive."Class" a WHERE t = 'Class'
     UNION ALL SELECT (to_jsonb(a) - 'archivedAt')::text FROM legacy_archive."Enrollment" a WHERE t = 'Enrollment'
     UNION ALL SELECT (to_jsonb(a) - 'archivedAt')::text FROM legacy_archive."Assignment" a WHERE t = 'Assignment'
     UNION ALL SELECT (to_jsonb(a) - 'archivedAt')::text FROM legacy_archive."AssignmentSubmission" a WHERE t = 'AssignmentSubmission'
     UNION ALL SELECT (to_jsonb(a) - 'archivedAt')::text FROM legacy_archive."Announcement" a WHERE t = 'Announcement'
     UNION ALL SELECT (to_jsonb(a) - 'archivedAt')::text FROM legacy_archive."WatchTracking" a WHERE t = 'WatchTracking'
     UNION ALL SELECT (to_jsonb(a) - 'archivedAt')::text FROM legacy_archive."UserBilling" a WHERE t = 'UserBilling'
     UNION ALL SELECT (to_jsonb(a) - 'archivedAt')::text FROM legacy_archive."Payment" a WHERE t = 'Payment') s)
  AS match
FROM unnest(ARRAY['Class','Enrollment','Assignment','AssignmentSubmission','Announcement','WatchTracking','UserBilling','Payment']) AS t;
