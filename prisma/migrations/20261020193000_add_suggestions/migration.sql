-- Learner suggestions and their safe, persisted attachments.
CREATE TYPE "SuggestionCategory" AS ENUM ('FEATURE', 'CONTENT', 'UI', 'BUG', 'OTHER');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'REVIEWING', 'RESPONDED', 'RESOLVED', 'REJECTED');
CREATE TYPE "SuggestionAttachmentType" AS ENUM ('IMAGE', 'FILE', 'LINK');

CREATE TABLE "Suggestion" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "category" "SuggestionCategory" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "adminResponse" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuggestionAttachment" (
    "id" SERIAL NOT NULL,
    "suggestionId" INTEGER NOT NULL,
    "type" "SuggestionAttachmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuggestionAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Suggestion_userId_createdAt_idx" ON "Suggestion"("userId", "createdAt");
CREATE INDEX "Suggestion_status_createdAt_idx" ON "Suggestion"("status", "createdAt");
CREATE INDEX "SuggestionAttachment_suggestionId_idx" ON "SuggestionAttachment"("suggestionId");

ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SuggestionAttachment" ADD CONSTRAINT "SuggestionAttachment_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
