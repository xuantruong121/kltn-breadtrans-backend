-- Forward-only reconciliation for a database that recorded the collocations
-- migration but does not contain the column, plus personal saved vocabulary.
ALTER TABLE "VocabWord" ADD COLUMN IF NOT EXISTS "collocations" JSONB;

CREATE TABLE IF NOT EXISTS "UserSavedWord" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "normalizedWord" TEXT NOT NULL,
    "displayWord" TEXT NOT NULL,
    "canonicalWord" TEXT NOT NULL,
    "partOfSpeech" TEXT,
    "meaningVi" TEXT,
    "definitionEn" TEXT,
    "ipaUs" TEXT,
    "ipaUk" TEXT,
    "exampleEn" TEXT,
    "exampleVi" TEXT,
    "collocations" JSONB,
    "synonyms" JSONB,
    "antonyms" JSONB,
    "audioUs" TEXT,
    "audioUk" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSavedWord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserSavedWord_userId_canonicalWord_partOfSpeech_key"
  ON "UserSavedWord"("userId", "canonicalWord", "partOfSpeech");
CREATE INDEX IF NOT EXISTS "UserSavedWord_userId_createdAt_idx"
  ON "UserSavedWord"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserSavedWord_userId_fkey'
  ) THEN
    ALTER TABLE "UserSavedWord"
      ADD CONSTRAINT "UserSavedWord_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
