-- CreateEnum
CREATE TYPE "DiagnosticAssessmentStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DiagnosticTaskType" AS ENUM ('MCQ', 'OPEN_TEXT', 'SPEAKING_RESPONSE', 'WRITING_RESPONSE');

-- CreateEnum
CREATE TYPE "DiagnosticSkill" AS ENUM ('LISTENING', 'READING', 'SPEAKING', 'WRITING', 'LANGUAGE_USE');

-- CreateEnum
CREATE TYPE "DiagnosticGradingStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'QUEUED', 'GRADING', 'GRADED', 'GRADING_FAILED');

-- CreateEnum
CREATE TYPE "DiagnosticCompletionState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_GRADING', 'COMPLETE', 'GRADING_FAILED');

-- DropIndex
DROP INDEX "SpeakingPracticeSet_scope_idx";

-- DropIndex
DROP INDEX "ToeicAttempt_userId_examId_status_idx";

-- AlterTable
ALTER TABLE "DailyBanhEarning" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DiagnosticAssessment" ADD COLUMN     "blueprintVersion" TEXT,
ADD COLUMN     "contentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "scoringVersion" TEXT NOT NULL DEFAULT 'OBJECTIVE_POOLED_V1',
ADD COLUMN     "status" "DiagnosticAssessmentStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "DiagnosticAttempt" ADD COLUMN     "blueprintVersion" TEXT,
ADD COLUMN     "contentVersion" INTEGER,
ADD COLUMN     "overallScore" DOUBLE PRECISION,
ADD COLUMN     "resultState" "DiagnosticCompletionState" NOT NULL DEFAULT 'IN_PROGRESS',
ADD COLUMN     "scoringVersion" TEXT;

-- AlterTable
ALTER TABLE "DiagnosticQuestion" ADD COLUMN     "difficulty" TEXT,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "intendedLevel" TEXT,
ADD COLUMN     "passageId" INTEGER,
ADD COLUMN     "prepSeconds" INTEGER,
ADD COLUMN     "responseSeconds" INTEGER,
ADD COLUMN     "rubricId" INTEGER,
ADD COLUMN     "skillCode" "DiagnosticSkill",
ADD COLUMN     "subskill" TEXT,
ADD COLUMN     "taskType" "DiagnosticTaskType" NOT NULL DEFAULT 'MCQ',
ADD COLUMN     "wordMax" INTEGER,
ADD COLUMN     "wordMin" INTEGER;

-- AlterTable
ALTER TABLE "DiagnosticSpeakingResponse" ADD COLUMN     "providerVersion" TEXT,
ADD COLUMN     "rubricId" INTEGER,
ADD COLUMN     "rubricVersion" TEXT;

-- AlterTable
ALTER TABLE "Exam" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MarketPhysicalRedemption" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SpeakingCategory" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserShippingProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "DiagnosticReadingPassage" (
    "id" SERIAL NOT NULL,
    "assessmentId" INTEGER NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticReadingPassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticListeningClip" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "durationMs" INTEGER,
    "byteSize" INTEGER,
    "script" TEXT NOT NULL,
    "scriptSha256" TEXT NOT NULL,
    "audioSha256" TEXT,
    "voice" TEXT,
    "locale" TEXT,
    "accent" TEXT,
    "generationSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticListeningClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticRubric" (
    "id" SERIAL NOT NULL,
    "skill" "DiagnosticSkill" NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticRubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticWritingResponse" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "assessmentId" INTEGER NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "taskKey" TEXT NOT NULL,
    "status" "DiagnosticGradingStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "responseText" TEXT,
    "wordCount" INTEGER,
    "score" DOUBLE PRECISION,
    "scoreMetadata" JSONB,
    "rubricId" INTEGER,
    "rubricVersion" TEXT,
    "provider" TEXT,
    "providerVersion" TEXT,
    "graderVersion" TEXT,
    "gradingAttempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "rawProviderPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "DiagnosticWritingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticSkillResult" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "skill" "DiagnosticSkill" NOT NULL,
    "status" "DiagnosticCompletionState" NOT NULL DEFAULT 'NOT_STARTED',
    "score" DOUBLE PRECISION,
    "band" TEXT,
    "itemsScored" INTEGER,
    "itemsTotal" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticSkillResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagnosticReadingPassage_assessmentId_order_idx" ON "DiagnosticReadingPassage"("assessmentId", "order");

-- CreateIndex
CREATE INDEX "DiagnosticListeningClip_questionId_isActive_idx" ON "DiagnosticListeningClip"("questionId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticListeningClip_questionId_version_key" ON "DiagnosticListeningClip"("questionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticRubric_skill_rubricVersion_key" ON "DiagnosticRubric"("skill", "rubricVersion");

-- CreateIndex
CREATE INDEX "DiagnosticWritingResponse_userId_assessmentId_status_idx" ON "DiagnosticWritingResponse"("userId", "assessmentId", "status");

-- CreateIndex
CREATE INDEX "DiagnosticWritingResponse_attemptId_status_idx" ON "DiagnosticWritingResponse"("attemptId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticWritingResponse_attemptId_questionId_key" ON "DiagnosticWritingResponse"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "DiagnosticSkillResult_attemptId_status_idx" ON "DiagnosticSkillResult"("attemptId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticSkillResult_attemptId_skill_key" ON "DiagnosticSkillResult"("attemptId", "skill");

-- CreateIndex
CREATE INDEX "DiagnosticAssessment_status_idx" ON "DiagnosticAssessment"("status");

-- CreateIndex
CREATE INDEX "DiagnosticQuestion_assessmentId_skillCode_idx" ON "DiagnosticQuestion"("assessmentId", "skillCode");

-- CreateIndex
CREATE INDEX "DiagnosticQuestion_passageId_idx" ON "DiagnosticQuestion"("passageId");

-- AddForeignKey
ALTER TABLE "DiagnosticQuestion" ADD CONSTRAINT "DiagnosticQuestion_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "DiagnosticReadingPassage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticQuestion" ADD CONSTRAINT "DiagnosticQuestion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "DiagnosticRubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticSpeakingResponse" ADD CONSTRAINT "DiagnosticSpeakingResponse_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "DiagnosticRubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticReadingPassage" ADD CONSTRAINT "DiagnosticReadingPassage_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "DiagnosticAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticListeningClip" ADD CONSTRAINT "DiagnosticListeningClip_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "DiagnosticQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticWritingResponse" ADD CONSTRAINT "DiagnosticWritingResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticWritingResponse" ADD CONSTRAINT "DiagnosticWritingResponse_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "DiagnosticAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticWritingResponse" ADD CONSTRAINT "DiagnosticWritingResponse_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "DiagnosticAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticWritingResponse" ADD CONSTRAINT "DiagnosticWritingResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "DiagnosticQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticWritingResponse" ADD CONSTRAINT "DiagnosticWritingResponse_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "DiagnosticRubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticSkillResult" ADD CONSTRAINT "DiagnosticSkillResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "DiagnosticAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ToeicAssessmentAttemptComponent_assessmentAttemptId_assessmentC" RENAME TO "ToeicAssessmentAttemptComponent_assessmentAttemptId_assessm_key";

-- RenameIndex
ALTER INDEX "ToeicAssessmentSpeakingSubmission_attemptComponentId_speakingSu" RENAME TO "ToeicAssessmentSpeakingSubmission_attemptComponentId_speaki_key";

-- RenameIndex
ALTER INDEX "ToeicAssessmentWritingSubmission_attemptComponentId_submissionI" RENAME TO "ToeicAssessmentWritingSubmission_attemptComponentId_submiss_key";

-- ---------------------------------------------------------------------------
-- Hand-written additions. Prisma cannot express a partial unique index, and
-- the legacy backfill below must happen inside the same migration so the
-- database is never briefly in a state where V1's versions are unstated.
-- ---------------------------------------------------------------------------

-- Backfill the legacy V1 form's explicit identity. scoringVersion and
-- contentVersion already received their column defaults; blueprintVersion has
-- no default because V2 forms must state their own, so V1 is named here.
UPDATE "DiagnosticAssessment"
SET "blueprintVersion" = 'V1_LEGACY_20_ITEM'
WHERE "blueprintVersion" IS NULL;

-- Pin historical attempts to the versions they were actually taken under, so a
-- future form or scorer can never reinterpret them.
UPDATE "DiagnosticAttempt" a
SET "scoringVersion"   = COALESCE(a."scoringVersion", s."scoringVersion"),
    "blueprintVersion" = COALESCE(a."blueprintVersion", s."blueprintVersion"),
    "contentVersion"   = COALESCE(a."contentVersion", s."contentVersion")
FROM "DiagnosticAssessment" s
WHERE a."assessmentId" = s."id";

-- Completed historical attempts are finished results, not in-progress ones.
UPDATE "DiagnosticAttempt"
SET "resultState" = 'COMPLETE'
WHERE "status" = 'COMPLETED';

-- Exactly one learner-current assessment is ALREADY enforced by
-- 20261022130000_enforce_single_active_diagnostic, which created a partial
-- unique index on ("isActive") WHERE "isActive" = true. That index is the
-- authoritative mechanism and is deliberately left as-is: a second,
-- independent guarantee on "status" would allow the two to disagree (for
-- example status = 'ACTIVE' with isActive = false), which is exactly the
-- two-sources-of-truth problem this migration must avoid.
--
-- "status" is therefore introduced as the publication LIFECYCLE
-- (DRAFT -> READY -> ACTIVE -> ARCHIVED) that V2 authoring needs, and is tied
-- to the existing selector by a check constraint so the two can never diverge.
-- Note that because at most one row may have isActive = true, the historical
-- "ORDER BY id DESC" in getCurrentAssessment can only ever see a single
-- candidate; it is not a live ambiguity.

-- Align the lifecycle with the existing authoritative selector before adding
-- the constraint.
UPDATE "DiagnosticAssessment"
SET "status" = CASE WHEN "isActive" THEN 'ACTIVE'::"DiagnosticAssessmentStatus"
                    ELSE 'ARCHIVED'::"DiagnosticAssessmentStatus" END;

-- One truth, two representations: ACTIVE if and only if isActive.
ALTER TABLE "DiagnosticAssessment"
ADD CONSTRAINT "DiagnosticAssessment_status_matches_isActive"
CHECK (("status" = 'ACTIVE') = "isActive");
