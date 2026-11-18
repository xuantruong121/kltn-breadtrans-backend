-- One claim per submission whose rewards and skill progress have run
-- (concurrency audit C1, 2026-11-18). Adds a table only.

-- CreateTable
CREATE TABLE "LearningEffectClaim" (
    "submissionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningEffectClaim_pkey" PRIMARY KEY ("submissionId")
);
