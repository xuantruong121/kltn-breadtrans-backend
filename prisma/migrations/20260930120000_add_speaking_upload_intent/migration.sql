-- CreateEnum
CREATE TYPE "SpeakingUploadIntentStatus" AS ENUM ('PENDING', 'FINALIZED', 'EXPIRED', 'CANCELLED', 'INVALID');

-- CreateTable
CREATE TABLE "SpeakingUploadIntent" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "expectedContentType" TEXT NOT NULL,
    "expectedSizeBytes" INTEGER NOT NULL,
    "expectedDurationMs" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "idempotencyKey" TEXT,
    "status" "SpeakingUploadIntentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "submissionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakingUploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingUploadIntent_objectKey_key" ON "SpeakingUploadIntent"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingUploadIntent_submissionId_key" ON "SpeakingUploadIntent"("submissionId");

-- CreateIndex
CREATE INDEX "SpeakingUploadIntent_userId_status_idx" ON "SpeakingUploadIntent"("userId", "status");

-- CreateIndex
CREATE INDEX "SpeakingUploadIntent_status_expiresAt_idx" ON "SpeakingUploadIntent"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SpeakingUploadIntent_createdAt_idx" ON "SpeakingUploadIntent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingUploadIntent_userId_idempotencyKey_key" ON "SpeakingUploadIntent"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "SpeakingUploadIntent" ADD CONSTRAINT "SpeakingUploadIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingUploadIntent" ADD CONSTRAINT "SpeakingUploadIntent_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "SpeakingExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingUploadIntent" ADD CONSTRAINT "SpeakingUploadIntent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "SpeakingSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
