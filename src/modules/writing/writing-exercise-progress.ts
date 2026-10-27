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
