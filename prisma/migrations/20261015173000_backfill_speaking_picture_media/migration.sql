-- Backfill the two audited TOEIC Describe a Picture exercises with the
-- existing public R2 catalog assets. Preserve any admin-authored media.
UPDATE "SpeakingExercise"
SET "imageUrl" = 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/toeic/shared/images/office-meeting.png'
WHERE "id" = 27
  AND "practiceSetId" = 'toeic-speaking-practice'
  AND "imageUrl" IS NULL;

UPDATE "SpeakingExercise"
SET "imageUrl" = 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/toeic/shared/images/departure-board.png'
WHERE "id" = 28
  AND "practiceSetId" = 'toeic-speaking-practice'
  AND "imageUrl" IS NULL;
