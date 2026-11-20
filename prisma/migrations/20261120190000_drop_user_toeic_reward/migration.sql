-- The TOEIC completion reward was removed (no caller since the 27/10 reward policy;
-- GamificationService.awardToeicReward deleted 20/11). The table held 0 rows on kltn_db.

-- DropForeignKey
ALTER TABLE "UserToeicReward" DROP CONSTRAINT "UserToeicReward_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserToeicReward" DROP CONSTRAINT "UserToeicReward_examId_fkey";

-- DropTable
DROP TABLE "UserToeicReward";
