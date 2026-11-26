-- Time a learner spends in practice rooms, per learner day and skill (owner 2026-11-26).
-- CreateTable
CREATE TABLE "StudyTime" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dayKey" VARCHAR(10) NOT NULL,
    "skill" VARCHAR(16) NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyTime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyTime_userId_dayKey_idx" ON "StudyTime"("userId", "dayKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyTime_userId_dayKey_skill_key" ON "StudyTime"("userId", "dayKey", "skill");

-- AddForeignKey
ALTER TABLE "StudyTime" ADD CONSTRAINT "StudyTime_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
