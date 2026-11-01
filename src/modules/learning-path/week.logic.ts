/**
 * The learner's week (F24): how the weekly minutes split across the four
 * skills, what is done so far, and a rough date for the next levels. The date
 * is an estimate from the unlock rule, not a promise. Pure: no Prisma, no I/O.
 */
import type { PracticeLevel, PracticeSkill } from '@prisma/client';

import { PRACTICE_SKILLS, PRACTICE_LEVEL_LABEL } from './placement.logic';
import { PROGRESS_ITEMS, nextLevel } from './progression.logic';

export const ITEM_MINUTES: Record<PracticeSkill, number> = {
  LISTENING: 10,
  READING: 10,
  SPEAKING: 10,
  WRITING: 15,
};

const DAY = 24 * 60 * 60 * 1000;
/** Vietnam time: a week turns over on Monday 00:00 local. */
const OFFSET = 7 * 60 * 60 * 1000;

/** Monday 00:00 in Vietnam of the week containing `now`. */
export function weekStart(now: Date): Date {
  const local = new Date(now.getTime() + OFFSET);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(midnight - sinceMonday * DAY - OFFSET);
}

/** Every skill counts once, goal skills and the weakest skill once more. */
export function skillWeights(
  goalSkills: PracticeSkill[],
  weakest: PracticeSkill | null,
): Record<PracticeSkill, number> {
  return Object.fromEntries(
    PRACTICE_SKILLS.map((skill) => [
      skill,
      1 + (goalSkills.includes(skill) ? 1 : 0) + (weakest === skill ? 1 : 0),
    ]),
  ) as Record<PracticeSkill, number>;
}

export function weeklyTargets(
  minutesPerDay: number,
  weights: Record<PracticeSkill, number>,
): Record<PracticeSkill, number> {
  const total = PRACTICE_SKILLS.reduce((sum, s) => sum + weights[s], 0);
  return Object.fromEntries(
    PRACTICE_SKILLS.map((skill) => [
      skill,
      Math.max(
        1,
        Math.round(
          (minutesPerDay * 7 * weights[skill]) / total / ITEM_MINUTES[skill],
        ),
      ),
    ]),
  ) as Record<PracticeSkill, number>;
}

export type SkillProgress = {
  skill: PracticeSkill;
  unlockedLevel: PracticeLevel;
  /** Items done at the unlocked level. */
  done: number;
};

/** Items still needed to reach the next level; 0 at the top level. */
export const itemsToNextLevel = (s: SkillProgress) =>
  nextLevel(s.unlockedLevel) ? Math.max(0, PROGRESS_ITEMS - s.done) : 0;

export function estimateNextLevels(input: {
  skills: SkillProgress[];
  minutesPerDay: number;
  targetDate: Date | null;
  now: Date;
}) {
  const open = input.skills.filter((s) => nextLevel(s.unlockedLevel));
  const minutes = open.reduce(
    (sum, s) => sum + itemsToNextLevel(s) * ITEM_MINUTES[s.skill],
    0,
  );
  const items = open.reduce((sum, s) => sum + itemsToNextLevel(s), 0);
  const days = Math.ceil(minutes / input.minutesPerDay);
  const date = new Date(input.now.getTime() + days * DAY);
  const target = input.targetDate;
  const daysLeft = target
    ? Math.ceil((target.getTime() - input.now.getTime()) / DAY)
    : null;
  return {
    items,
    days,
    date,
    targetDate: target,
    onTrack: target ? date.getTime() <= target.getTime() : null,
    /** Daily minutes that would meet the target; null when it has passed. */
    minutesNeeded:
      daysLeft !== null && daysLeft > 0 ? Math.ceil(minutes / daysLeft) : null,
  };
}

export function nextLevelLabel(level: PracticeLevel): string | null {
  const next = nextLevel(level);
  return next ? PRACTICE_LEVEL_LABEL[next] : null;
}
