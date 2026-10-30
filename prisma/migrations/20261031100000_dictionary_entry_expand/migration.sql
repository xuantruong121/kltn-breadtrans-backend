-- F13: one dictionary store shared by vocab decks and every lookup.
-- Expand: create DictionaryEntry, copy every VocabWord into it (one entry
-- per lower(word), lower(pos)), link deck rows, and take the Speaking lookup
-- dictionary (a hidden SYSTEM_DICTIONARY topic) and the canonical lemmas
-- seeded into deck 1 out of the decks. Learner progress keeps its word ids.

CREATE TYPE "DictionaryEntrySource" AS ENUM ('CURATED', 'EXTERNAL', 'AI');
CREATE TYPE "DictionaryEntryStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');

CREATE TABLE "DictionaryEntry" (
    "id" SERIAL NOT NULL,
    "headword" TEXT NOT NULL,
    "displayWord" TEXT NOT NULL,
    "pos" TEXT NOT NULL DEFAULT 'noun',
    "ipaUs" TEXT,
    "ipaUk" TEXT,
    "audioUs" TEXT,
    "audioUk" TEXT,
    "meaningVi" TEXT NOT NULL,
    "definitionEn" TEXT,
    "exampleEn" TEXT,
    "exampleVi" TEXT,
    "collocations" JSONB,
    "synonyms" JSONB,
    "antonyms" JSONB,
    "source" "DictionaryEntrySource" NOT NULL DEFAULT 'CURATED',
    "status" "DictionaryEntryStatus" NOT NULL DEFAULT 'APPROVED',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DictionaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DictionaryEntry_headword_pos_key" ON "DictionaryEntry"("headword", "pos");
CREATE INDEX "DictionaryEntry_headword_idx" ON "DictionaryEntry"("headword");
CREATE INDEX "DictionaryEntry_status_idx" ON "DictionaryEntry"("status");

-- One entry per (word, part of speech); the oldest row wins on a tie.
INSERT INTO "DictionaryEntry" (
    "headword", "displayWord", "pos", "ipaUs", "ipaUk", "audioUs", "audioUk",
    "meaningVi", "exampleEn", "exampleVi", "collocations", "updatedAt"
)
SELECT DISTINCT ON (lower(btrim(w."word")), lower(btrim(w."pos")))
    lower(btrim(w."word")),
    btrim(w."word"),
    lower(btrim(w."pos")),
    NULLIF(btrim(w."ipaUs"), ''),
    NULLIF(btrim(w."ipaUk"), ''),
    NULLIF(btrim(w."audioUs"), ''),
    NULLIF(btrim(w."audioUk"), ''),
    w."meaning",
    w."exampleEn",
    w."exampleVi",
    w."collocations",
    CURRENT_TIMESTAMP
FROM "VocabWord" w
ORDER BY lower(btrim(w."word")), lower(btrim(w."pos")), w."id";

ALTER TABLE "VocabWord" ADD COLUMN "entryId" INTEGER;

UPDATE "VocabWord" w
SET "entryId" = e."id"
FROM "DictionaryEntry" e
WHERE e."headword" = lower(btrim(w."word"))
  AND e."pos" = lower(btrim(w."pos"));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "VocabWord" WHERE "entryId" IS NULL) THEN
        RAISE EXCEPTION 'F13: a VocabWord row has no dictionary entry';
    END IF;
END $$;

-- The Speaking lookup dictionary is now the store itself, not a deck.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "VocabWord" w
        JOIN "VocabTopic" t ON t."id" = w."topicId"
        WHERE t."categoryName" = 'SYSTEM_DICTIONARY'
          AND (
              EXISTS (SELECT 1 FROM "UserVocabWordProgress" p WHERE p."wordId" = w."id")
              OR EXISTS (SELECT 1 FROM "UserVocabMasteryReward" r WHERE r."wordId" = w."id")
          )
    ) THEN
        RAISE EXCEPTION 'F13: learner data points at SYSTEM_DICTIONARY rows';
    END IF;
END $$;

DELETE FROM "VocabWord" w
USING "VocabTopic" t
WHERE t."id" = w."topicId" AND t."categoryName" = 'SYSTEM_DICTIONARY';

DELETE FROM "VocabTopic" WHERE "categoryName" = 'SYSTEM_DICTIONARY';

-- The canonical lookup lemmas (seed ids 1001-1010) were placed in deck 1 at
-- order 0, ahead of the deck's own words. Their entries stay for lookup;
-- deck rows a learner already studied are kept.
DELETE FROM "VocabWord" w
WHERE w."id" BETWEEN 1001 AND 1010
  AND w."topicId" = 1
  AND NOT EXISTS (SELECT 1 FROM "UserVocabWordProgress" p WHERE p."wordId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "UserVocabMasteryReward" r WHERE r."wordId" = w."id");

-- Positions 1..n per deck, keeping the current relative order.
UPDATE "VocabWord" w
SET "order" = r.rn
FROM (
    SELECT "id", row_number() OVER (PARTITION BY "topicId" ORDER BY "order", "id") AS rn
    FROM "VocabWord"
) r
WHERE r."id" = w."id";

UPDATE "VocabTopic" t
SET "totalWords" = (SELECT count(*) FROM "VocabWord" w WHERE w."topicId" = t."id");

ALTER TABLE "VocabWord" ALTER COLUMN "entryId" SET NOT NULL;

ALTER TABLE "VocabWord"
    ADD CONSTRAINT "VocabWord_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "DictionaryEntry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "VocabWord_entryId_idx" ON "VocabWord"("entryId");
CREATE UNIQUE INDEX "VocabWord_topicId_entryId_key" ON "VocabWord"("topicId", "entryId");
