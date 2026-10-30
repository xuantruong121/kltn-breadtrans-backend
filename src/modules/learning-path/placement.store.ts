/**
 * Writes a four-skill Entry Diagnostic result into the learner's practice
 * levels (LearnerSkillLevel, LevelUnlock PLACEMENT, LearnerProfile).
 *
 * Called from refreshFourSkillResult, which runs at submission, after every
 * grading outcome and when the result is read, so it must be idempotent:
 * - a skill is written once per attempt; Speaking/Writing are written when
 *   their grading completes, later than Listening/Reading;
 * - a level the learner reached afterwards (gate test, progress) is never
 *   lowered by re-reading the same attempt;
 * - an older attempt never overrides a newer placement;
 * - unlocks only grow.
 */
import type { PracticeSkill, PrismaClient } from '@prisma/client';

import {
  ABILITY_SEED,
  levelsUpTo,
  maxLevel,
  placeFromScores,
  PRACTICE_SKILLS,
  type Placement,
  type SkillScores,
} from './placement.logic';

type Db = Pick<
  PrismaClient,
  'learnerProfile' | 'learnerSkillLevel' | 'levelUnlock'
>;

/** Skill states and scores as the four-skill scorer reports them. */
export type DiagnosticSkillOutcome = Partial<
  Record<PracticeSkill, { state: string; score: number | null }>
>;

export function scoresFromOutcome(
  outcome: DiagnosticSkillOutcome,
): SkillScores {
  return Object.fromEntries(
    PRACTICE_SKILLS.map((skill) => {
      const s = outcome[skill];
      return [skill, s?.state === 'COMPLETE' ? s.score : null];
    }),
  );
}

export async function applyDiagnosticPlacement(
  db: Db,
  userId: number,
  attemptId: number,
  outcome: DiagnosticSkillOutcome,
): Promise<Placement | null> {
  const placement = placeFromScores(scoresFromOutcome(outcome));
  if (!placement.overall) return null;
  const profile = await db.learnerProfile.findUnique({ where: { userId } });
  if (
    profile?.placementAttemptId != null &&
    profile.placementAttemptId > attemptId
  )
    return null;
  const sameAttempt = profile?.placementAttemptId === attemptId;

  for (const skill of PRACTICE_SKILLS) {
    const level = placement.skills[skill];
    if (!level) continue;
    const existing = await db.learnerSkillLevel.findUnique({
      where: { userId_skill: { userId, skill } },
    });
    if (existing?.source === 'DIAGNOSTIC' && sameAttempt) continue;
    await db.learnerSkillLevel.upsert({
      where: { userId_skill: { userId, skill } },
      create: {
        userId,
        skill,
        level,
        unlockedLevel: level,
        ability: ABILITY_SEED[level],
        source: 'DIAGNOSTIC',
      },
      update: {
        level,
        unlockedLevel: maxLevel(existing?.unlockedLevel ?? level, level),
        ability: ABILITY_SEED[level],
        source: 'DIAGNOSTIC',
      },
    });
    await db.levelUnlock.createMany({
      data: levelsUpTo(level).map((l) => ({
        userId,
        skill,
        level: l,
        method: 'PLACEMENT' as const,
        evidence: { diagnosticAttemptId: attemptId },
      })),
      skipDuplicates: true,
    });
  }

  await db.learnerProfile.upsert({
    where: { userId },
    create: {
      userId,
      placementLevel: placement.overall,
      placementSource: 'DIAGNOSTIC',
      placementAttemptId: attemptId,
    },
    update: {
      placementLevel: placement.overall,
      placementSource: 'DIAGNOSTIC',
      placementAttemptId: attemptId,
    },
  });
  return placement;
}
