-- CreateEnum
CREATE TYPE "LearningTrack" AS ENUM ('GENERAL', 'IT_SOFTWARE', 'OFFICE_BUSINESS', 'SALES_CUSTOMER_SERVICE', 'HOSPITALITY_TOURISM', 'STUDENT_ACADEMIC');

-- CreateEnum
CREATE TYPE "PracticeLevel" AS ENUM ('STARTER', 'BASIC', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "LearningGoal" AS ENUM ('GENERAL', 'TOEIC_SCORE', 'WORK_COMMUNICATION', 'STUDY', 'TRAVEL');

-- CreateEnum
CREATE TYPE "PlacementSource" AS ENUM ('NONE', 'DIAGNOSTIC', 'SELF');

-- CreateEnum
CREATE TYPE "PracticeSkill" AS ENUM ('LISTENING', 'READING', 'SPEAKING', 'WRITING');

-- CreateEnum
CREATE TYPE "LevelUnlockMethod" AS ENUM ('PLACEMENT', 'SELF_CHOICE', 'GATE_TEST', 'PATH_PROGRESS');

-- CreateEnum
CREATE TYPE "LearningContentType" AS ENUM ('QUIZ', 'SPEAKING_SET', 'CONTENT_TOPIC');

-- CreateEnum
CREATE TYPE "LearningPlanItemStatus" AS ENUM ('SUGGESTED', 'SAVED', 'DONE', 'DISMISSED');

-- CreateTable
CREATE TABLE "LearnerProfile" (
    "userId" INTEGER NOT NULL,
    "track" "LearningTrack" NOT NULL DEFAULT 'GENERAL',
    "goal" "LearningGoal" NOT NULL DEFAULT 'GENERAL',
    "minutesPerDay" INTEGER NOT NULL DEFAULT 15,
    "targetDate" TIMESTAMP(3),
    "selfLevel" "PracticeLevel",
    "placementLevel" "PracticeLevel",
    "placementSource" "PlacementSource" NOT NULL DEFAULT 'NONE',
    "placementAttemptId" INTEGER,
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LearnerSkillLevel" (
    "userId" INTEGER NOT NULL,
    "skill" "PracticeSkill" NOT NULL,
    "level" "PracticeLevel" NOT NULL,
    "unlockedLevel" "PracticeLevel" NOT NULL,
    "ability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" "PlacementSource" NOT NULL DEFAULT 'NONE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerSkillLevel_pkey" PRIMARY KEY ("userId","skill")
);

-- CreateTable
CREATE TABLE "LevelUnlock" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "skill" "PracticeSkill" NOT NULL,
    "level" "PracticeLevel" NOT NULL,
    "method" "LevelUnlockMethod" NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "skill" "PracticeSkill" NOT NULL,
    "level" "PracticeLevel" NOT NULL,
    "questionIds" JSONB NOT NULL,
    "answers" JSONB,
    "score" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "GateAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTrackTag" (
    "contentType" "LearningContentType" NOT NULL,
    "contentId" INTEGER NOT NULL,
    "track" "LearningTrack" NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentTrackTag_pkey" PRIMARY KEY ("contentType","contentId","track")
);

-- CreateTable
CREATE TABLE "ContentDifficulty" (
    "contentType" "LearningContentType" NOT NULL,
    "contentId" INTEGER NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDifficulty_pkey" PRIMARY KEY ("contentType","contentId")
);

-- CreateTable
CREATE TABLE "LearningPlanItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "contentType" "LearningContentType" NOT NULL,
    "contentId" INTEGER NOT NULL,
    "skill" "PracticeSkill" NOT NULL,
    "level" "PracticeLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LearningPlanItemStatus" NOT NULL DEFAULT 'SUGGESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LevelUnlock_userId_skill_idx" ON "LevelUnlock"("userId", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUnlock_userId_skill_level_key" ON "LevelUnlock"("userId", "skill", "level");

-- CreateIndex
CREATE INDEX "GateAttempt_userId_skill_level_createdAt_idx" ON "GateAttempt"("userId", "skill", "level", "createdAt");

-- CreateIndex
CREATE INDEX "ContentTrackTag_track_idx" ON "ContentTrackTag"("track");

-- CreateIndex
CREATE INDEX "LearningPlanItem_userId_status_idx" ON "LearningPlanItem"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPlanItem_userId_contentType_contentId_key" ON "LearningPlanItem"("userId", "contentType", "contentId");

-- AddForeignKey
ALTER TABLE "LearnerProfile" ADD CONSTRAINT "LearnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerSkillLevel" ADD CONSTRAINT "LearnerSkillLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUnlock" ADD CONSTRAINT "LevelUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateAttempt" ADD CONSTRAINT "GateAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPlanItem" ADD CONSTRAINT "LearningPlanItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

