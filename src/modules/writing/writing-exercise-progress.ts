import type { Prisma, PrismaClient } from '@prisma/client';

import {
  summarizeWritingExercise,
  type WritingTaskGrade,
} from './practice-writing-grading';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The learner's latest graded answer for each task of a Writing exercise,
 * read from Result rows (one per submitted task), and the exercise summary.
 * A Result counts only when its submission stored a usable grade.
 */
export async function loadWritingExerciseProgress(
  db: Db,
  userId: number,
  quizId: number,
  questionIds: number[],
) {
  const rows = await db.result.findMany({
    where: {
      questionId: { in: questionIds },
      submission: { userId, quizId },
    },
    select: {
      questionId: true,
      score: true,
      submission: { select: { id: true, submittedAt: true, aiFeedback: true } },
    },
    orderBy: [{ submission: { submittedAt: 'desc' } }, { id: 'desc' }],
  });
  const latest = new Map<number, WritingTaskGrade & { submissionId: number }>();
  for (const row of rows) {
    if (latest.has(row.questionId) || row.score === null) continue;
    let maxScore = 0;
    try {
      maxScore = Number(
        (
          JSON.parse(row.submission.aiFeedback ?? '{}') as {
            maxScore?: unknown;
          }
        ).maxScore,
      );
    } catch {
      maxScore = 0;
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) continue;
    latest.set(row.questionId, {
      score: row.score,
      maxScore,
      submissionId: row.submission.id,
    });
  }
  return { latest, summary: summarizeWritingExercise(questionIds, latest) };
}

/**
 * Catalog completion: a Writing quiz counts as completed only when every one
 * of its tasks has a graded answer from the learner, the same condition that
 * releases the exercise reward. One graded task of five is not completion.
 */
export function completedWritingQuizIds(
  questions: Array<{ id: number; quizId: number }>,
  gradedQuestionIds: Iterable<number>,
): Set<number> {
  const graded = new Set(gradedQuestionIds);
  const pending = new Map<number, boolean>();
  for (const q of questions) {
    pending.set(
      q.quizId,
      (pending.get(q.quizId) ?? false) || !graded.has(q.id),
    );
  }
  return new Set(
    [...pending].filter(([, hasPending]) => !hasPending).map(([id]) => id),
  );
}

/**
 * Catalog learning state of each exercise: COMPLETED when every task has a
 * graded answer (the same rule as completedWritingQuizIds and the reward),
 * IN_PROGRESS when some do, NOT_STARTED otherwise.
 */
export function writingCompletionStatuses(
  questions: Array<{ id: number; quizId: number }>,
  gradedQuestionIds: Iterable<number>,
): Map<number, 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'> {
  const graded = new Set(gradedQuestionIds);
  const counts = new Map<number, { done: number; total: number }>();
  for (const q of questions) {
    const c = counts.get(q.quizId) ?? { done: 0, total: 0 };
    c.total += 1;
    if (graded.has(q.id)) c.done += 1;
    counts.set(q.quizId, c);
  }
  return new Map(
    [...counts].map(([id, c]) => [
      id,
      c.done === 0
        ? 'NOT_STARTED'
        : c.done === c.total
          ? 'COMPLETED'
          : 'IN_PROGRESS',
    ]),
  );
}

/**
 * XP for a completed standalone Writing exercise: one point per percent of
 * the final server-computed score (92 % → 92 XP, at most 100). The shared
 * listener computes `score × 10`, which suits Listening/Reading, whose score
 * is a count of correct answers; Writing's score is a percentage, so it
 * passes this value instead. Bread, badges and quests keep using `score`.
 */
export function writingCompletionXp(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}
