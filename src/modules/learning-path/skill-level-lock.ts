import type { PracticeSkill, Prisma } from '@prisma/client';

/**
 * The lock every writer of one learner's skill level takes inside its
 * transaction: graded practice, a gate test, the Entry Diagnostic placement
 * and a self-chosen level (audit C6, 2026-11-18). Each reads the row and
 * writes from what it read, so without one lock a level opened by one was
 * lowered by another.
 */
export async function lockSkillLevel(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  userId: number,
  skill: PracticeSkill,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`learner-progress:${userId}:${skill}`}, 0))`;
}
