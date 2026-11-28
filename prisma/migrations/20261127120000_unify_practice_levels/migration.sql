-- Every content level uses the four practice levels (owner 2026-11-27):
-- STARTER "Mất gốc", BASIC "Cơ bản", INTERMEDIATE "Trung cấp", ADVANCED "Nâng cao".
-- CEFR codes (A1..C2) and BEGINNER leave the content tables.
--
-- Conversion agreed with the owner:
--   A1, A1-A2                         -> STARTER
--   A2                                -> BASIC
--   B1, B2, B1-B2, A2-B1, A2-B2, A1-B1 -> INTERMEDIATE
--   any range reaching C1 or C2       -> ADVANCED (keeps PRO for those items)
--   BEGINNER                          -> BASIC; INTERMEDIATE, ADVANCED unchanged
-- Quiz titles are NOT changed: learner titles and the starter roadmap look them up.
-- A value outside the table stops the migration instead of being guessed.

CREATE FUNCTION pg_temp.bt_practice_level(raw text) RETURNS "PracticeLevel"
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text := upper(btrim(coalesce(raw, '')));
  m text[];
  lo text;
  hi text;
BEGIN
  IF v IN ('STARTER', 'BASIC', 'INTERMEDIATE', 'ADVANCED') THEN
    RETURN v::"PracticeLevel";
  END IF;
  IF v = 'BEGINNER' THEN
    RETURN 'BASIC';
  END IF;
  -- The level head of a title ("Listening B1 — Work") or a bare level ("A1-A2").
  v := split_part(v, ' — ', 1);
  m := regexp_match(v, '([ABC][12])(?:\s*[–-]\s*([ABC][12]))?');
  IF m IS NULL THEN
    RAISE EXCEPTION 'unify_practice_levels: no level in "%"', raw;
  END IF;
  lo := least(m[1], coalesce(m[2], m[1]));
  hi := greatest(m[1], coalesce(m[2], m[1]));
  IF hi >= 'C1' THEN
    RETURN 'ADVANCED';
  END IF;
  IF lo = 'A1' AND hi <= 'A2' THEN
    RETURN 'STARTER';
  END IF;
  IF lo = 'A2' AND hi = 'A2' THEN
    RETURN 'BASIC';
  END IF;
  RETURN 'INTERMEDIATE';
END $$;

-- Quiz: the level of a standalone skill practice, read once from its title.
ALTER TABLE "Quiz" ADD COLUMN "practiceLevel" "PracticeLevel";

UPDATE "Quiz" q
SET "practiceLevel" = pg_temp.bt_practice_level(q.title)
WHERE q.type IN ('LISTENING_PRACTICE', 'BILINGUAL_READING', 'WRITING_PICTURE', 'WRITING_EMAIL')
  AND q.title ~ '[ABC][12]'
  AND NOT EXISTS (SELECT 1 FROM "ToeicWritingSetItem" i WHERE i."writingQuizId" = q.id);

-- A writing practice with no tag in its title (8 on 2026-11-27) is BASIC, as
-- the owner chose: it stays free, now with a level.
UPDATE "Quiz" q
SET "practiceLevel" = 'BASIC'
WHERE q.type IN ('WRITING_PICTURE', 'WRITING_EMAIL')
  AND q."practiceLevel" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "ToeicWritingSetItem" i WHERE i."writingQuizId" = q.id);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Quiz" q
  WHERE q.type IN ('LISTENING_PRACTICE', 'BILINGUAL_READING')
    AND q."practiceLevel" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'unify_practice_levels: % listening/reading practice without a level', n;
  END IF;
END $$;

CREATE INDEX "Quiz_type_practiceLevel_idx" ON "Quiz"("type", "practiceLevel");

-- Question content of a skill practice: "level" A1..C2 -> practice level.
UPDATE "Question" qu
SET content = jsonb_set(qu.content, '{level}', to_jsonb(pg_temp.bt_practice_level(qu.content->>'level')::text))
FROM "Quiz" q
WHERE q.id = qu."quizId"
  AND q.type IN ('LISTENING_PRACTICE', 'BILINGUAL_READING', 'WRITING_PICTURE', 'WRITING_EMAIL')
  AND jsonb_typeof(qu.content) = 'object'
  AND coalesce(qu.content->>'level', '') <> '';

-- Speaking practice sets.
ALTER TABLE "SpeakingPracticeSet"
  ALTER COLUMN "level" TYPE "PracticeLevel" USING pg_temp.bt_practice_level("level");

-- Speaking exercises.
ALTER TABLE "SpeakingExercise" ALTER COLUMN "difficulty" DROP DEFAULT;
ALTER TABLE "SpeakingExercise"
  ALTER COLUMN "difficulty" TYPE "PracticeLevel" USING pg_temp.bt_practice_level("difficulty");
ALTER TABLE "SpeakingExercise" ALTER COLUMN "difficulty" SET DEFAULT 'BASIC';

-- Vocabulary decks (a deck may have no level).
ALTER TABLE "VocabTopic"
  ALTER COLUMN "level" TYPE "PracticeLevel"
  USING CASE WHEN "level" IS NULL OR btrim("level") = '' THEN NULL ELSE pg_temp.bt_practice_level("level") END;

-- Grammar topics.
ALTER TABLE "GrammarTopic" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "GrammarTopic"
  ALTER COLUMN "level" TYPE "PracticeLevel" USING pg_temp.bt_practice_level("level");
ALTER TABLE "GrammarTopic" ALTER COLUMN "level" SET DEFAULT 'BASIC';
