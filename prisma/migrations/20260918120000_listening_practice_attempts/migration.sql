-- Server-backed resumable sessions for non-TOEIC listening practice.
CREATE TYPE "ListeningPracticeAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

CREATE TABLE "ListeningPracticeAttempt" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "quizId" INTEGER NOT NULL,
  "currentQuestionId" INTEGER,
  "answers" JSONB NOT NULL DEFAULT '{}',
  "questionStates" JSONB NOT NULL DEFAULT '{}',
  "status" "ListeningPracticeAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "ListeningPracticeAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListeningPracticeAttempt_userId_quizId_status_idx"
  ON "ListeningPracticeAttempt"("userId", "quizId", "status");

ALTER TABLE "ListeningPracticeAttempt"
  ADD CONSTRAINT "ListeningPracticeAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListeningPracticeAttempt"
  ADD CONSTRAINT "ListeningPracticeAttempt_quizId_fkey"
  FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
