const { Client } = require("pg");
require("dotenv").config();

const SQL_STATEMENTS = [
  'ALTER TABLE "MarketOrder" ALTER COLUMN "totalBanh" SET DATA TYPE INTEGER',
  'ALTER TABLE "MarketOrder" ALTER COLUMN "balanceAtCheckout" SET DATA TYPE INTEGER',
  'ALTER TABLE "MarketProduct" ALTER COLUMN "price" SET DATA TYPE INTEGER',
  'ALTER TABLE "UserStats" ADD COLUMN IF NOT EXISTS "doubleBanhUntil" TIMESTAMP(3)',
  'CREATE TABLE IF NOT EXISTS "DailyBanhEarning" ("id" SERIAL NOT NULL, "userId" INTEGER NOT NULL, "dateKey" TEXT NOT NULL, "earnedBanh" INTEGER NOT NULL DEFAULT 0, "vocabCount" INTEGER NOT NULL DEFAULT 0, "speakingCount" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DailyBanhEarning_pkey" PRIMARY KEY ("id"))',
  'CREATE TABLE IF NOT EXISTS "BanhTransaction" ("id" SERIAL NOT NULL, "userId" INTEGER NOT NULL, "amount" INTEGER NOT NULL, "source" TEXT NOT NULL, "reference" TEXT, "dateKey" TEXT NOT NULL, "isCapped" BOOLEAN NOT NULL DEFAULT true, "balanceAfter" INTEGER NOT NULL, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "BanhTransaction_pkey" PRIMARY KEY ("id"))',
  'CREATE TABLE IF NOT EXISTS "UserVocabMasteryReward" ("id" SERIAL NOT NULL, "userId" INTEGER NOT NULL, "wordId" INTEGER NOT NULL, "rewardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "UserVocabMasteryReward_pkey" PRIMARY KEY ("id"))',
  'CREATE TABLE IF NOT EXISTS "UserToeicReward" ("id" SERIAL NOT NULL, "userId" INTEGER NOT NULL, "examId" INTEGER NOT NULL, "mode" TEXT NOT NULL, "rewardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "UserToeicReward_pkey" PRIMARY KEY ("id"))',
  'CREATE INDEX IF NOT EXISTS "DailyBanhEarning_dateKey_idx" ON "DailyBanhEarning"("dateKey")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "DailyBanhEarning_userId_dateKey_key" ON "DailyBanhEarning"("userId", "dateKey")',
  'CREATE INDEX IF NOT EXISTS "BanhTransaction_userId_dateKey_idx" ON "BanhTransaction"("userId", "dateKey")',
  'CREATE INDEX IF NOT EXISTS "BanhTransaction_userId_createdAt_idx" ON "BanhTransaction"("userId", "createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "BanhTransaction_userId_source_reference_key" ON "BanhTransaction"("userId", "source", "reference")',
  'CREATE INDEX IF NOT EXISTS "UserVocabMasteryReward_userId_idx" ON "UserVocabMasteryReward"("userId")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "UserVocabMasteryReward_userId_wordId_key" ON "UserVocabMasteryReward"("userId", "wordId")',
  'CREATE INDEX IF NOT EXISTS "UserToeicReward_userId_idx" ON "UserToeicReward"("userId")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "UserToeicReward_userId_examId_mode_key" ON "UserToeicReward"("userId", "examId", "mode")',
  'ALTER TABLE "DailyBanhEarning" DROP CONSTRAINT IF EXISTS "DailyBanhEarning_userId_fkey"',
  'ALTER TABLE "DailyBanhEarning" ADD CONSTRAINT "DailyBanhEarning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "BanhTransaction" DROP CONSTRAINT IF EXISTS "BanhTransaction_userId_fkey"',
  'ALTER TABLE "BanhTransaction" ADD CONSTRAINT "BanhTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "UserVocabMasteryReward" DROP CONSTRAINT IF EXISTS "UserVocabMasteryReward_userId_fkey"',
  'ALTER TABLE "UserVocabMasteryReward" ADD CONSTRAINT "UserVocabMasteryReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "UserVocabMasteryReward" DROP CONSTRAINT IF EXISTS "UserVocabMasteryReward_wordId_fkey"',
  'ALTER TABLE "UserVocabMasteryReward" ADD CONSTRAINT "UserVocabMasteryReward_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "VocabWord"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "UserToeicReward" DROP CONSTRAINT IF EXISTS "UserToeicReward_userId_fkey"',
  'ALTER TABLE "UserToeicReward" ADD CONSTRAINT "UserToeicReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "UserToeicReward" DROP CONSTRAINT IF EXISTS "UserToeicReward_examId_fkey"',
  'ALTER TABLE "UserToeicReward" ADD CONSTRAINT "UserToeicReward_examId_fkey" FOREIGN KEY ("examId") REFERENCES "ToeicExamSet"("id") ON DELETE CASCADE ON UPDATE CASCADE',
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const q of SQL_STATEMENTS) {
    try {
      await client.query(q);
      console.log("OK:", q.slice(0, 70));
    } catch (e) {
      console.log("ERR:", q.slice(0, 70), "->", e.message);
    }
  }
  await client.end();
  console.log("Migration complete");
}

main().catch(console.error);
