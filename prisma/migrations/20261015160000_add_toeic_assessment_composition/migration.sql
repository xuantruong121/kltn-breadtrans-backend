-- Additive TOEIC parent composition. Existing child runtimes and records remain intact.
CREATE TYPE "ToeicAssessmentProductFamily" AS ENUM ('TOEIC_LR', 'TOEIC_SW', 'TOEIC_4_SKILLS');
CREATE TYPE "ToeicAssessmentComponentKind" AS ENUM ('LISTENING_READING', 'SPEAKING', 'WRITING');
CREATE TYPE "ToeicAssessmentAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "ToeicAssessmentAttemptComponentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

CREATE TABLE "ToeicAssessment" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "productFamily" "ToeicAssessmentProductFamily" NOT NULL,
    "publicationStatus" "QuizPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ToeicAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToeicAssessmentComponent" (
    "id" SERIAL NOT NULL,
    "assessmentId" INTEGER NOT NULL,
    "kind" "ToeicAssessmentComponentKind" NOT NULL,
    "order" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "lrExamSetId" INTEGER,
    "speakingPracticeSetId" TEXT,
    "writingSetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ToeicAssessmentComponent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ToeicAssessmentComponent_source_check" CHECK (
      ("kind" = 'LISTENING_READING' AND "lrExamSetId" IS NOT NULL AND "speakingPracticeSetId" IS NULL AND "writingSetId" IS NULL)
      OR ("kind" = 'SPEAKING' AND "lrExamSetId" IS NULL AND "speakingPracticeSetId" IS NOT NULL AND "writingSetId" IS NULL)
      OR ("kind" = 'WRITING' AND "lrExamSetId" IS NULL AND "speakingPracticeSetId" IS NULL AND "writingSetId" IS NOT NULL)
    )
);

CREATE TABLE "ToeicAssessmentAttempt" (
    "id" SERIAL NOT NULL,
    "assessmentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "ToeicAssessmentAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ToeicAssessmentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToeicAssessmentAttemptComponent" (
    "id" SERIAL NOT NULL,
    "assessmentAttemptId" INTEGER NOT NULL,
    "assessmentComponentId" INTEGER NOT NULL,
    "status" "ToeicAssessmentAttemptComponentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "toeicAttemptId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ToeicAssessmentAttemptComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToeicAssessmentSpeakingSubmission" (
    "id" SERIAL NOT NULL,
    "attemptComponentId" INTEGER NOT NULL,
    "speakingSubmissionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToeicAssessmentSpeakingSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToeicAssessmentWritingSubmission" (
    "id" SERIAL NOT NULL,
    "attemptComponentId" INTEGER NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToeicAssessmentWritingSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ToeicAssessment_publicationStatus_productFamily_idx" ON "ToeicAssessment"("publicationStatus", "productFamily");
CREATE INDEX "ToeicAssessmentComponent_lrExamSetId_idx" ON "ToeicAssessmentComponent"("lrExamSetId");
CREATE INDEX "ToeicAssessmentComponent_speakingPracticeSetId_idx" ON "ToeicAssessmentComponent"("speakingPracticeSetId");
CREATE INDEX "ToeicAssessmentComponent_writingSetId_idx" ON "ToeicAssessmentComponent"("writingSetId");
CREATE UNIQUE INDEX "ToeicAssessmentComponent_assessmentId_order_key" ON "ToeicAssessmentComponent"("assessmentId", "order");
CREATE UNIQUE INDEX "ToeicAssessmentComponent_assessmentId_kind_key" ON "ToeicAssessmentComponent"("assessmentId", "kind");
CREATE INDEX "ToeicAssessmentAttempt_userId_assessmentId_status_idx" ON "ToeicAssessmentAttempt"("userId", "assessmentId", "status");
CREATE UNIQUE INDEX "ToeicAssessmentAttempt_userId_assessmentId_idempotencyKey_key" ON "ToeicAssessmentAttempt"("userId", "assessmentId", "idempotencyKey");
CREATE INDEX "ToeicAssessmentAttemptComponent_assessmentAttemptId_status_idx" ON "ToeicAssessmentAttemptComponent"("assessmentAttemptId", "status");
CREATE UNIQUE INDEX "ToeicAssessmentAttemptComponent_assessmentAttemptId_assessmentComponentId_key" ON "ToeicAssessmentAttemptComponent"("assessmentAttemptId", "assessmentComponentId");
CREATE UNIQUE INDEX "ToeicAssessmentAttemptComponent_toeicAttemptId_key" ON "ToeicAssessmentAttemptComponent"("toeicAttemptId");
CREATE UNIQUE INDEX "ToeicAssessmentSpeakingSubmission_attemptComponentId_speakingSubmissionId_key" ON "ToeicAssessmentSpeakingSubmission"("attemptComponentId", "speakingSubmissionId");
CREATE UNIQUE INDEX "ToeicAssessmentSpeakingSubmission_speakingSubmissionId_key" ON "ToeicAssessmentSpeakingSubmission"("speakingSubmissionId");
CREATE UNIQUE INDEX "ToeicAssessmentWritingSubmission_attemptComponentId_submissionId_key" ON "ToeicAssessmentWritingSubmission"("attemptComponentId", "submissionId");
CREATE UNIQUE INDEX "ToeicAssessmentWritingSubmission_submissionId_key" ON "ToeicAssessmentWritingSubmission"("submissionId");

ALTER TABLE "ToeicAssessment" ADD CONSTRAINT "ToeicAssessment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentComponent" ADD CONSTRAINT "ToeicAssessmentComponent_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ToeicAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentComponent" ADD CONSTRAINT "ToeicAssessmentComponent_lrExamSetId_fkey" FOREIGN KEY ("lrExamSetId") REFERENCES "ToeicExamSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentComponent" ADD CONSTRAINT "ToeicAssessmentComponent_speakingPracticeSetId_fkey" FOREIGN KEY ("speakingPracticeSetId") REFERENCES "SpeakingPracticeSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentComponent" ADD CONSTRAINT "ToeicAssessmentComponent_writingSetId_fkey" FOREIGN KEY ("writingSetId") REFERENCES "ToeicWritingSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentAttempt" ADD CONSTRAINT "ToeicAssessmentAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ToeicAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentAttempt" ADD CONSTRAINT "ToeicAssessmentAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentAttemptComponent" ADD CONSTRAINT "ToeicAssessmentAttemptComponent_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "ToeicAssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentAttemptComponent" ADD CONSTRAINT "ToeicAssessmentAttemptComponent_assessmentComponentId_fkey" FOREIGN KEY ("assessmentComponentId") REFERENCES "ToeicAssessmentComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentAttemptComponent" ADD CONSTRAINT "ToeicAssessmentAttemptComponent_toeicAttemptId_fkey" FOREIGN KEY ("toeicAttemptId") REFERENCES "ToeicAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentSpeakingSubmission" ADD CONSTRAINT "ToeicAssessmentSpeakingSubmission_attemptComponentId_fkey" FOREIGN KEY ("attemptComponentId") REFERENCES "ToeicAssessmentAttemptComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentSpeakingSubmission" ADD CONSTRAINT "ToeicAssessmentSpeakingSubmission_speakingSubmissionId_fkey" FOREIGN KEY ("speakingSubmissionId") REFERENCES "SpeakingSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentWritingSubmission" ADD CONSTRAINT "ToeicAssessmentWritingSubmission_attemptComponentId_fkey" FOREIGN KEY ("attemptComponentId") REFERENCES "ToeicAssessmentAttemptComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToeicAssessmentWritingSubmission" ADD CONSTRAINT "ToeicAssessmentWritingSubmission_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
