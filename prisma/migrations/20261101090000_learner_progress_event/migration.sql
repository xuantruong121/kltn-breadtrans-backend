-- F15: one row per graded practice attempt; idempotency for ability updates
-- and the data behind the path-progress unlock rule.
CREATE TABLE "LearnerProgressEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "skill" "PracticeSkill" NOT NULL,
    "level" "PracticeLevel" NOT NULL,
    "contentType" "LearningContentType" NOT NULL,
    "contentId" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "scorePercent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerProgressEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearnerProgressEvent_userId_sourceKey_key" ON "LearnerProgressEvent"("userId", "sourceKey");
CREATE INDEX "LearnerProgressEvent_userId_skill_level_idx" ON "LearnerProgressEvent"("userId", "skill", "level");

ALTER TABLE "LearnerProgressEvent" ADD CONSTRAINT "LearnerProgressEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
