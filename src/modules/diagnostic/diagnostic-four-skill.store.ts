/**
 * Persistence for FOUR_SKILL_PLACEMENT_V2 results.
 *
 * Objective skills (Listening, Reading, Language Use) are final at
 * submission and are written once as `DiagnosticSkillResult` rows. Speaking
 * and Writing change as grading runs, so `refreshFourSkillResult` recomputes
 * them from the productive rows and rewrites the skill rows, the attempt's
 * `resultState` and `overallScore`. It is idempotent and is called after
 * submission, after every grading outcome or retry, and when a result is
 * read, so the stored state can never stay behind the grading state.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import {
  FOUR_SKILL_SCORING_VERSION,
  type FourSkillKey,
  type FourSkillResult,
  scoreFourSkillPlacementV2,
} from './diagnostic-four-skill';

type Db = Pick<
  PrismaClient,
  | 'diagnosticAttempt'
  | 'diagnosticSkillResult'
  | 'diagnosticQuestion'
  | 'diagnosticSpeakingResponse'
  | 'diagnosticWritingResponse'
>;

const OBJECTIVE: FourSkillKey[] = ['LISTENING', 'READING', 'LANGUAGE_USE'];

/** Called inside the submission transaction with the graded objective items. */
export async function writeObjectiveSkillRows(
  tx: Pick<Prisma.TransactionClient, 'diagnosticSkillResult'>,
  attemptId: number,
  result: FourSkillResult,
) {
  for (const skill of OBJECTIVE) {
    const s = result.skills[skill];
    await tx.diagnosticSkillResult.upsert({
      where: { attemptId_skill: { attemptId, skill } },
      create: {
        attemptId,
        skill,
        status: s.state,
        score: s.score,
        itemsScored: s.itemsScored,
        itemsTotal: s.itemsTotal,
      },
      update: {
        status: s.state,
        score: s.score,
        itemsScored: s.itemsScored,
        itemsTotal: s.itemsTotal,
      },
    });
  }
}

export async function refreshFourSkillResult(
  db: Db,
  attemptId: number,
): Promise<FourSkillResult | null> {
  const attempt = await db.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      assessmentId: true,
      status: true,
      scoringVersion: true,
      skillResults: true,
    },
  });
  if (
    !attempt ||
    attempt.scoringVersion !== FOUR_SKILL_SCORING_VERSION ||
    attempt.status !== 'COMPLETED'
  )
    return null;

  // Objective outcomes are reconstructed from their stored counts.
  const objective = OBJECTIVE.flatMap((skill) => {
    const row = attempt.skillResults.find((r) => r.skill === skill);
    const total = row?.itemsTotal ?? 0;
    const correct = row?.itemsScored ?? 0;
    return Array.from({ length: total }, (_, i) => ({
      section: skill,
      isCorrect: i < correct,
    }));
  });
  const productive = await db.diagnosticQuestion.findMany({
    where: {
      assessmentId: attempt.assessmentId,
      taskType: { in: ['SPEAKING_RESPONSE', 'WRITING_RESPONSE'] },
    },
    select: { id: true, taskType: true },
  });
  const [speaking, writing] = await Promise.all([
    db.diagnosticSpeakingResponse.findMany({
      where: { attemptId },
      select: { questionId: true, status: true, score: true },
    }),
    db.diagnosticWritingResponse.findMany({
      where: { attemptId },
      select: { questionId: true, status: true, score: true },
    }),
  ]);
  const result = scoreFourSkillPlacementV2({
    objective,
    speakingQuestionIds: productive
      .filter((q) => q.taskType === 'SPEAKING_RESPONSE')
      .map((q) => q.id),
    speaking,
    writingQuestionIds: productive
      .filter((q) => q.taskType === 'WRITING_RESPONSE')
      .map((q) => q.id),
    writing,
  });

  for (const skill of ['SPEAKING', 'WRITING'] as const) {
    const s = result.skills[skill];
    await db.diagnosticSkillResult.upsert({
      where: { attemptId_skill: { attemptId, skill } },
      create: {
        attemptId,
        skill,
        status: s.state,
        score: s.score,
        itemsScored: s.itemsScored,
        itemsTotal: s.itemsTotal,
      },
      update: {
        status: s.state,
        score: s.score,
        itemsScored: s.itemsScored,
        itemsTotal: s.itemsTotal,
      },
    });
  }
  await db.diagnosticAttempt.update({
    where: { id: attemptId },
    data: { resultState: result.state, overallScore: result.overall },
  });
  return result;
}
