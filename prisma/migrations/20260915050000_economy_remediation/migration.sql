-- Economy Remediation Migration
-- Separates EXP from Banh Ran, adds atomic daily cap ledger,
-- lifetime idempotency tables, and converts Float currency to Int.

-- AlterTable: MarketOrder Float -> Int
ALTER TABLE "MarketOrder" ALTER COLUMN "totalBanh" SET DATA TYPE INTEGER,
ALTER COLUMN "balanceAtCheckout" SET DATA TYPE INTEGER;

-- AlterTable: MarketProduct price Float -> Int
ALTER TABLE "MarketProduct" ALTER COLUMN "price" SET DATA TYPE INTEGER;

-- AlterTable: UserStats add doubleBanhUntil
ALTER TABLE "UserStats" ADD COLUMN "doubleBanhUntil" TIMESTAMP(3);

-- CreateTable: DailyBanhEarning
CREATE TABLE "DailyBanhEarning" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dateKey" TEXT NOT NULL,
    "earnedBanh" INTEGER NOT NULL DEFAULT 0,
    "vocabCount" INTEGER NOT NULL DEFAULT 0,
    "speakingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyBanhEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BanhTransaction
CREATE TABLE "BanhTransaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT,
    "dateKey" TEXT NOT NULL,
    "isCapped" BOOLEAN NOT NULL DEFAULT true,
    "balanceAfter" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BanhTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UserVocabMasteryReward
CREATE TABLE "UserVocabMasteryReward" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "rewardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserVocabMasteryReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UserToeicReward
CREATE TABLE "UserToeicReward" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "examId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "rewardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserToeicReward_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "DailyBanhEarning_dateKey_idx" ON "DailyBanhEarning"("dateKey");
CREATE UNIQUE INDEX "DailyBanhEarning_userId_dateKey_key" ON "DailyBanhEarning"("userId", "dateKey");
CREATE INDEX "BanhTransaction_userId_dateKey_idx" ON "BanhTransaction"("userId", "dateKey");
CREATE INDEX "BanhTransaction_userId_createdAt_idx" ON "BanhTransaction"("userId", "createdAt");
CREATE UNIQUE INDEX "BanhTransaction_userId_source_reference_key" ON "BanhTransaction"("userId", "source", "reference");
CREATE INDEX "UserVocabMasteryReward_userId_idx" ON "UserVocabMasteryReward"("userId");
CREATE UNIQUE INDEX "UserVocabMasteryReward_userId_wordId_key" ON "UserVocabMasteryReward"("userId", "wordId");
CREATE INDEX "UserToeicReward_userId_idx" ON "UserToeicReward"("userId");
CREATE UNIQUE INDEX "UserToeicReward_userId_examId_mode_key" ON "UserToeicReward"("userId", "examId", "mode");

-- Foreign Keys
ALTER TABLE "DailyBanhEarning" ADD CONSTRAINT "DailyBanhEarning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BanhTransaction" ADD CONSTRAINT "BanhTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserVocabMasteryReward" ADD CONSTRAINT "UserVocabMasteryReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserVocabMasteryReward" ADD CONSTRAINT "UserVocabMasteryReward_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "VocabWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserToeicReward" ADD CONSTRAINT "UserToeicReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserToeicReward" ADD CONSTRAINT "UserToeicReward_examId_fkey" FOREIGN KEY ("examId") REFERENCES "ToeicExamSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
