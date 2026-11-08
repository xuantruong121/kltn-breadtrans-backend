-- Bảng xếp hạng (owner 2026-11-08): XP by day and month, the streak board,
-- and a feed of recent learning. Indexes only, plus one new table.
CREATE INDEX "PointHistory_createdAt_idx" ON "PointHistory"("createdAt");
CREATE INDEX "PointHistory_userId_createdAt_idx" ON "PointHistory"("userId", "createdAt");
CREATE INDEX "UserStats_streakCount_idx" ON "UserStats"("streakCount");
CREATE INDEX "LearningActivity_occurredAt_idx" ON "LearningActivity"("occurredAt");

CREATE TABLE "LearnerEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearnerEvent_createdAt_idx" ON "LearnerEvent"("createdAt");
CREATE INDEX "LearnerEvent_userId_createdAt_idx" ON "LearnerEvent"("userId", "createdAt");

ALTER TABLE "LearnerEvent" ADD CONSTRAINT "LearnerEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
