-- Mistake notebook: two new tables. Additive; no existing table changes.
-- CreateTable
CREATE TABLE "LearnerMistake" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "skill" VARCHAR(16) NOT NULL,
    "sourceType" VARCHAR(24) NOT NULL,
    "itemKey" VARCHAR(191) NOT NULL,
    "tag" VARCHAR(120),
    "detail" JSONB NOT NULL,
    "wrongCount" INTEGER NOT NULL DEFAULT 1,
    "correctStreak" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LearnerMistake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerMistakeIngest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerMistakeIngest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearnerMistake_userId_resolvedAt_lastSeenAt_idx" ON "LearnerMistake"("userId", "resolvedAt", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerMistake_userId_sourceType_itemKey_key" ON "LearnerMistake"("userId", "sourceType", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerMistakeIngest_userId_kind_sourceId_key" ON "LearnerMistakeIngest"("userId", "kind", "sourceId");

-- AddForeignKey
ALTER TABLE "LearnerMistake" ADD CONSTRAINT "LearnerMistake_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerMistakeIngest" ADD CONSTRAINT "LearnerMistakeIngest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

