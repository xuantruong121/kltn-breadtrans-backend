-- Only one resumable session may be active for a learner and listening quiz.
CREATE UNIQUE INDEX "ListeningPracticeAttempt_one_active_per_user_quiz"
  ON "ListeningPracticeAttempt"("userId", "quizId")
  WHERE "status" = 'IN_PROGRESS';
