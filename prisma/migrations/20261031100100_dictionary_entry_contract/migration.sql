-- F13 contract: the word fields now live only on DictionaryEntry.
ALTER TABLE "VocabWord"
    DROP COLUMN "word",
    DROP COLUMN "pos",
    DROP COLUMN "ipaUs",
    DROP COLUMN "ipaUk",
    DROP COLUMN "meaning",
    DROP COLUMN "audioUs",
    DROP COLUMN "audioUk",
    DROP COLUMN "exampleEn",
    DROP COLUMN "exampleVi",
    DROP COLUMN "collocations";
