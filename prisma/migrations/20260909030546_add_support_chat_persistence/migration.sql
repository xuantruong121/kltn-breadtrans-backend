-- CreateEnum
CREATE TYPE "SupportMode" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "SupportSenderRole" AS ENUM ('STUDENT', 'ADMIN', 'AI', 'SYSTEM');

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "mode" "SupportMode" NOT NULL DEFAULT 'AI',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "senderUserId" INTEGER,
    "senderRole" "SupportSenderRole" NOT NULL DEFAULT 'STUDENT',
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_studentId_key" ON "SupportConversation"("studentId");

-- CreateIndex
CREATE INDEX "SupportConversation_lastMessageAt_idx" ON "SupportConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_studentId_status_idx" ON "SupportConversation"("studentId", "status");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_senderUserId_idx" ON "SupportMessage"("senderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_conversationId_clientMessageId_key" ON "SupportMessage"("conversationId", "clientMessageId");

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
