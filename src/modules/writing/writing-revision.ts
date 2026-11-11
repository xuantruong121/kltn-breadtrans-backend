import type { Prisma, PrismaClient } from '@prisma/client';

import {
  numberChain,
  storedAttempt,
  type RevisionAttempt,
} from './writing-revision.logic';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The graded texts of one revision chain, oldest first: the first submission
 * and every revision that points at it. Rows without a usable practice grade
 * are left out.
 */
export async function loadRevisionChain(
  db: Db,
  rootSubmissionId: number,
): Promise<RevisionAttempt[]> {
  const rows = await db.submission.findMany({
    where: {
      OR: [{ id: rootSubmissionId }, { revisionOfId: rootSubmissionId }],
      score: { not: null },
    },
    select: {
      id: true,
      submittedAt: true,
      aiFeedback: true,
      results: {
        select: { answer: true },
        orderBy: { id: 'asc' },
        take: 1,
      },
    },
  });
  return numberChain(
    rows
      .map((row) => storedAttempt({ ...row, answer: row.results[0]?.answer }))
      .filter((attempt): attempt is NonNullable<typeof attempt> => !!attempt),
  );
}
