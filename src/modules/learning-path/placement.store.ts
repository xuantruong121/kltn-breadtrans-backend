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
import type {
  PracticeLevel,
  PracticeSkill,
  PrismaClient,
} from '@prisma/client';

import { lockSkillLevel } from './skill-level-lock';
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
> &
  Partial<Pick<PrismaClient, '$transaction' | '$executeRaw'>>;

/**
 * One skill's read and write under the skill-level lock (audit C6,
 * 2026-11-18): progress or a gate test opening a level in between was
 * lowered by a write made from a stale read. A client runs it in its own
 * transaction; a transaction takes the lock in itself; unit fakes, which
 * have neither, run it as is.
 */
async function inSkillLock<T>(
  db: Db,
  userId: number,
  skill: PracticeSkill,
  work: (client: Db) => Promise<T>,
): Promise<T> {
  if (typeof db.$transaction === 'function')
    return (db as PrismaClient).$transaction(async (tx) => {
      await lockSkillLevel(tx, userId, skill);
      return work(tx);
    });
  if (typeof db.$executeRaw === 'function')
    await lockSkillLevel(
      db as Pick<PrismaClient, '$executeRaw'>,
      userId,
      skill,
    );
  return work(db);
}

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
    await inSkillLock(db, userId, skill, async (db) => {
      const existing = await db.learnerSkillLevel.findUnique({
        where: { userId_skill: { userId, skill } },
      });
      if (existing?.source === 'DIAGNOSTIC' && sameAttempt) return;
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
        // Only raises (owner 2026-11-18): Speaking and Writing are graded
        // later, minutes or days after the attempt, and a learner who
        // practised up meanwhile kept the higher level, as with a gate test.
        update: {
          level: maxLevel(existing?.level ?? level, level),
          unlockedLevel: maxLevel(existing?.unlockedLevel ?? level, level),
          ability: Math.max(
            existing?.ability ?? ABILITY_SEED[level],
            ABILITY_SEED[level],
          ),
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

/**
 * The learner picks a level without the diagnostic ("Tự chọn mức", including
 * Mất gốc). Every skill not placed by a diagnostic gets that level; unlocks
 * only grow, so choosing a lower level never locks what was open. Levels
 * above the choice still need a gate test or progress.
 */
export async function applySelfLevel(
  db: Db & Pick<PrismaClient, 'learnerProgressEvent'>,
  userId: number,
  level: PracticeLevel,
): Promise<void> {
  for (const skill of PRACTICE_SKILLS) {
    await inSkillLock(db, userId, skill, async (db) => {
      const existing = await db.learnerSkillLevel.findUnique({
        where: { userId_skill: { userId, skill } },
      });
      if (existing?.source === 'DIAGNOSTIC') return;
      // Ability earned from graded practice outranks a self-chosen starting point.
      const practised = await (
        db as Db & Pick<PrismaClient, 'learnerProgressEvent'>
      ).learnerProgressEvent.count({
        where: { userId, skill },
      });
      await db.learnerSkillLevel.upsert({
        where: { userId_skill: { userId, skill } },
        create: {
          userId,
          skill,
          level,
          unlockedLevel: level,
          ability: ABILITY_SEED[level],
          source: 'SELF',
        },
        update: {
          level,
          unlockedLevel: maxLevel(existing?.unlockedLevel ?? level, level),
          ...(practised ? {} : { ability: ABILITY_SEED[level] }),
          source: 'SELF',
        },
      });
      await db.levelUnlock.createMany({
        data: levelsUpTo(level).map((l) => ({
          userId,
          skill,
          level: l,
          method: 'SELF_CHOICE' as const,
        })),
        skipDuplicates: true,
      });
    });
  }
  await db.learnerProfile.upsert({
    where: { userId },
    create: { userId, selfLevel: level, placementSource: 'SELF' },
    update: { selfLevel: level, placementSource: 'SELF' },
  });
}
