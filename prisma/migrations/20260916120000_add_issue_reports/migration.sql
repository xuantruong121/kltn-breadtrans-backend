-- CreateEnum
CREATE TYPE "IssueReportArea" AS ENUM ('LISTENING', 'SPEAKING', 'READING', 'WRITING', 'VOCABULARY', 'GRAMMAR', 'TOEIC', 'COURSE', 'DASHBOARD', 'MARKET', 'PET', 'AUTH', 'ADMIN', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueReportCategory" AS ENUM ('CONTENT_ERROR', 'ANSWER_ERROR', 'EXPLANATION_ERROR', 'AUDIO_ERROR', 'IMAGE_ERROR', 'SCORING_ERROR', 'TECHNICAL_ERROR', 'ACCESSIBILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueReportImpact" AS ENUM ('NON_BLOCKING', 'BLOCKING');

-- CreateEnum
CREATE TYPE "IssueReportStatus" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "IssueReport" (
  "id" SERIAL NOT NULL,
  "reportCode" TEXT NOT NULL,
  "reporterId" INTEGER NOT NULL,
  "assignedAdminId" INTEGER,
  "area" "IssueReportArea" NOT NULL,
  "category" "IssueReportCategory" NOT NULL,
  "impact" "IssueReportImpact" NOT NULL DEFAULT 'NON_BLOCKING',
  "status" "IssueReportStatus" NOT NULL DEFAULT 'NEW',
  "description" TEXT NOT NULL,
  "route" TEXT,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "questionId" INTEGER,
  "context" JSONB,
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IssueReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IssueReport_reportCode_key" ON "IssueReport"("reportCode");
CREATE INDEX "IssueReport_status_createdAt_idx" ON "IssueReport"("status", "createdAt");
CREATE INDEX "IssueReport_area_category_idx" ON "IssueReport"("area", "category");
CREATE INDEX "IssueReport_reporterId_createdAt_idx" ON "IssueReport"("reporterId", "createdAt");

ALTER TABLE "IssueReport" ADD CONSTRAINT "IssueReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueReport" ADD CONSTRAINT "IssueReport_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
