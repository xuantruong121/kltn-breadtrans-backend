-- Each picture of "Viết câu theo tranh" is its own exercise (owner 2026-11-24):
-- a picture task pays a fifth of a set on its first grade, once per learner.
-- Generated with `npm run db:migrate:diff:safe` (shadow database only).

-- CreateTable
CREATE TABLE "UserQuestionReward" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserQuestionReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserQuestionReward_userId_questionId_key" ON "UserQuestionReward"("userId", "questionId");

-- AddForeignKey
ALTER TABLE "UserQuestionReward" ADD CONSTRAINT "UserQuestionReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuestionReward" ADD CONSTRAINT "UserQuestionReward_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
