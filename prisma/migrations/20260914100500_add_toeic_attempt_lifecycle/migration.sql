CREATE TYPE "AttemptStatus" AS ENUM ('PENDING_START', 'IN_PROGRESS', 'SUBMITTED');
CREATE TYPE "IntegrityEventType" AS ENUM ('FULLSCREEN_EXIT', 'TAB_HIDDEN', 'WINDOW_BLUR', 'COPY_ATTEMPT', 'PASTE_ATTEMPT', 'CONTEXT_MENU_ATTEMPT');

ALTER TABLE "ToeicExamSet" ADD COLUMN "durationSeconds" INTEGER NOT NULL DEFAULT 7200;
ALTER TABLE "ToeicExamSet" ADD CONSTRAINT "ToeicExamSet_durationSeconds_check" CHECK ("durationSeconds" BETWEEN 60 AND 21600);

ALTER TABLE "ToeicQuestionGroup" ADD COLUMN "canonicalAccent" TEXT NOT NULL DEFAULT 'US';
UPDATE "ToeicQuestionGroup" SET "canonicalAccent" = 'US' WHERE "canonicalAccent" NOT IN ('US', 'UK');
ALTER TABLE "ToeicQuestionGroup" ADD CONSTRAINT "ToeicQuestionGroup_canonicalAccent_check" CHECK ("canonicalAccent" IN ('US', 'UK'));

ALTER TABLE "ToeicAttempt"
  ADD COLUMN "status" "AttemptStatus" NOT NULL DEFAULT 'PENDING_START',
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deadline" TIMESTAMP(3),
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "listeningCorrect" INTEGER,
  ADD COLUMN "readingCorrect" INTEGER,
  ADD COLUMN "totalCorrect" INTEGER;

UPDATE "ToeicAttempt" ta
SET "durationSeconds" = COALESCE((SELECT e."durationSeconds" FROM "ToeicExamSet" e WHERE e.id = ta."examId"), 7200);
UPDATE "ToeicAttempt"
SET "status" = 'SUBMITTED',
    "deadline" = "startedAt" + ("durationSeconds" * INTERVAL '1 second')
WHERE "submittedAt" IS NOT NULL;
UPDATE "ToeicAttempt"
SET "status" = 'SUBMITTED',
    "deadline" = "startedAt" + ("durationSeconds" * INTERVAL '1 second'),
    "submittedAt" = "startedAt" + ("durationSeconds" * INTERVAL '1 second')
WHERE "submittedAt" IS NULL AND "startedAt" IS NOT NULL
  AND "startedAt" + ("durationSeconds" * INTERVAL '1 second') < NOW();
UPDATE "ToeicAttempt"
SET "status" = 'IN_PROGRESS',
    "deadline" = "startedAt" + ("durationSeconds" * INTERVAL '1 second')
WHERE "submittedAt" IS NULL AND "startedAt" IS NOT NULL
  AND "startedAt" + ("durationSeconds" * INTERVAL '1 second') >= NOW();
UPDATE "ToeicAttempt" SET "durationSeconds" = GREATEST(60, LEAST(21600, "durationSeconds"));
ALTER TABLE "ToeicAttempt"
  ALTER COLUMN "durationSeconds" SET NOT NULL,
  ALTER COLUMN "startedAt" DROP DEFAULT,
  ALTER COLUMN "startedAt" DROP NOT NULL,
  ADD CONSTRAINT "ToeicAttempt_durationSeconds_check" CHECK ("durationSeconds" BETWEEN 60 AND 21600);

CREATE TABLE "ToeicIntegrityEvent" (
  "id" SERIAL NOT NULL,
  "attemptId" INTEGER NOT NULL,
  "eventType" "IntegrityEventType" NOT NULL,
  "questionId" INTEGER,
  "part" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "ToeicIntegrityEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ToeicIntegrityEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ToeicAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ToeicIntegrityEvent_attemptId_createdAt_idx" ON "ToeicIntegrityEvent"("attemptId", "createdAt");
CREATE INDEX "ToeicAttempt_userId_examId_status_idx" ON "ToeicAttempt"("userId", "examId", "status");

-- Promote only structurally valid four-skill bundles. Arrays containing FOUR_SKILL metadata are malformed candidates and fail below.
WITH candidates AS (
  SELECT q.id, q."bilingualContent"
  FROM "Quiz" q
  WHERE q.type = 'TOEIC'
    AND ((jsonb_typeof(q."bilingualContent") = 'object' AND q."bilingualContent"->>'examFormat' = 'FOUR_SKILL')
      OR (jsonb_typeof(q."bilingualContent") = 'array' AND jsonb_path_exists(q."bilingualContent", '$[*] ? (@.examFormat == "FOUR_SKILL")')))
), parsed AS (
  SELECT c.id AS quiz_id,
    jsonb_typeof(c."bilingualContent") = 'object' AS is_object,
    CASE WHEN jsonb_typeof(c."bilingualContent") = 'object' AND c."bilingualContent"->>'isBundle' IN ('true','false') THEN (c."bilingualContent"->>'isBundle')::boolean ELSE NULL END AS is_bundle,
    CASE WHEN jsonb_typeof(c."bilingualContent") = 'object' AND c."bilingualContent"->>'listeningReadingExamSetId' ~ '^[1-9][0-9]*$' THEN (c."bilingualContent"->>'listeningReadingExamSetId')::integer ELSE NULL END AS lr_id,
    CASE WHEN jsonb_typeof(c."bilingualContent") = 'object' AND c."bilingualContent"->>'speakingWritingQuizId' ~ '^[1-9][0-9]*$' THEN (c."bilingualContent"->>'speakingWritingQuizId')::integer ELSE NULL END AS sw_id
  FROM candidates c
), valid AS (
  SELECT p.*,
    EXISTS (SELECT 1 FROM "ToeicExamSet" e WHERE e.id = p.lr_id) AS lr_exists,
    EXISTS (SELECT 1 FROM "Quiz" s WHERE s.id = p.sw_id AND ((s.type = 'TOEIC' AND s."bilingualContent"->>'examFormat' = 'SPEAKING_WRITING') OR s.type IN ('WRITING_PICTURE','WRITING_EMAIL','LISTENING_PRACTICE','BILINGUAL_READING'))) AS sw_exists,
    p.sw_id <> p.quiz_id AS not_self_reference
  FROM parsed p
)
UPDATE "Quiz" q SET type = 'TOEIC_FOUR_SKILL'
FROM valid v
WHERE q.id = v.quiz_id AND v.is_object AND v.is_bundle = true AND v.lr_id IS NOT NULL AND v.sw_id IS NOT NULL
  AND v.lr_exists AND v.sw_exists AND v.not_self_reference;

DO $$
DECLARE malformed_count INTEGER;
BEGIN
  WITH candidates AS (
    SELECT q.id, q."bilingualContent"
    FROM "Quiz" q
    WHERE q.type = 'TOEIC'
      AND ((jsonb_typeof(q."bilingualContent") = 'object' AND q."bilingualContent"->>'examFormat' = 'FOUR_SKILL')
        OR (jsonb_typeof(q."bilingualContent") = 'array' AND jsonb_path_exists(q."bilingualContent", '$[*] ? (@.examFormat == "FOUR_SKILL")')))
  ), parsed AS (
    SELECT c.id AS quiz_id,
      jsonb_typeof(c."bilingualContent") = 'object' AS is_object,
      CASE WHEN jsonb_typeof(c."bilingualContent") = 'object' AND c."bilingualContent"->>'isBundle' IN ('true','false') THEN (c."bilingualContent"->>'isBundle')::boolean ELSE NULL END AS is_bundle,
      CASE WHEN jsonb_typeof(c."bilingualContent") = 'object' AND c."bilingualContent"->>'listeningReadingExamSetId' ~ '^[1-9][0-9]*$' THEN (c."bilingualContent"->>'listeningReadingExamSetId')::integer ELSE NULL END AS lr_id,
      CASE WHEN jsonb_typeof(c."bilingualContent") = 'object' AND c."bilingualContent"->>'speakingWritingQuizId' ~ '^[1-9][0-9]*$' THEN (c."bilingualContent"->>'speakingWritingQuizId')::integer ELSE NULL END AS sw_id
    FROM candidates c
  )
  SELECT COUNT(*) INTO malformed_count FROM parsed p
  WHERE NOT (p.is_object AND p.is_bundle = true AND p.lr_id IS NOT NULL AND p.sw_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM "ToeicExamSet" e WHERE e.id = p.lr_id)
    AND EXISTS (SELECT 1 FROM "Quiz" s WHERE s.id = p.sw_id AND ((s.type = 'TOEIC' AND s."bilingualContent"->>'examFormat' = 'SPEAKING_WRITING') OR s.type IN ('WRITING_PICTURE','WRITING_EMAIL','LISTENING_PRACTICE','BILINGUAL_READING')))
    AND p.sw_id <> p.quiz_id);
  IF malformed_count > 0 THEN RAISE EXCEPTION 'Migration blocked: % malformed FOUR_SKILL bundle candidate(s). Repair rows before rerun.', malformed_count; END IF;
END $$;

DO $$
DECLARE duplicates INTEGER;
BEGIN
  UPDATE "ToeicAttempt" SET "status"='SUBMITTED', "submittedAt"=COALESCE("submittedAt", "deadline") WHERE "status"='IN_PROGRESS' AND "deadline" < NOW();
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId", "examId", mode ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 1 WHEN 'PENDING_START' THEN 2 ELSE 3 END, id DESC) rn
    FROM "ToeicAttempt" WHERE status IN ('PENDING_START','IN_PROGRESS')
  ) DELETE FROM "ToeicAttempt" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  SELECT COUNT(*) INTO duplicates FROM (SELECT "userId", "examId", mode FROM "ToeicAttempt" WHERE status IN ('PENDING_START','IN_PROGRESS') GROUP BY 1,2,3 HAVING COUNT(*) > 1) d;
  IF duplicates > 0 THEN RAISE EXCEPTION 'Duplicate active attempts remain: %', duplicates; END IF;
END $$;
CREATE UNIQUE INDEX "ToeicAttempt_one_active_per_user_exam_mode" ON "ToeicAttempt" ("userId", "examId", mode) WHERE status IN ('PENDING_START','IN_PROGRESS');
