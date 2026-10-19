-- Additive TOEIC Writing composition layer. Content and grading remain owned by Quiz/Submission/Result.
CREATE TABLE "ToeicWritingSet" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToeicWritingSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToeicWritingSetItem" (
    "id" SERIAL NOT NULL,
    "writingSetId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "taskKind" TEXT NOT NULL,
    "writingQuizId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToeicWritingSetItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ToeicWritingSetItem_writingSetId_order_key"
  ON "ToeicWritingSetItem"("writingSetId", "order");
CREATE UNIQUE INDEX "ToeicWritingSetItem_writingSetId_writingQuizId_key"
  ON "ToeicWritingSetItem"("writingSetId", "writingQuizId");
CREATE INDEX "ToeicWritingSetItem_writingQuizId_idx"
  ON "ToeicWritingSetItem"("writingQuizId");

ALTER TABLE "ToeicWritingSetItem"
  ADD CONSTRAINT "ToeicWritingSetItem_writingSetId_fkey"
  FOREIGN KEY ("writingSetId") REFERENCES "ToeicWritingSet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ToeicWritingSetItem"
  ADD CONSTRAINT "ToeicWritingSetItem_writingQuizId_fkey"
  FOREIGN KEY ("writingQuizId") REFERENCES "Quiz"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ToeicWritingSetItem"
  ADD CONSTRAINT "ToeicWritingSetItem_taskKind_check"
  CHECK ("taskKind" IN ('PICTURE_SENTENCE', 'WRITTEN_REQUEST', 'OPINION_ESSAY'));
