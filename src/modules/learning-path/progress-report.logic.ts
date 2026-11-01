/**
 * "Tiến bộ của bạn" (F27): what the learner has done per skill and how far
 * the level moved since it was first set. Internal practice indicators, not a
 * proficiency result. Pure: no Prisma, no I/O.
 */
import type { PracticeLevel, PracticeSkill } from '@prisma/client';

import { PRACTICE_SKILLS, levelIndex } from './placement.logic';

type Event = { skill: PracticeSkill; scorePercent: number; createdAt: Date };

const mean = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;

/** Average of the last `size` attempts against the ones before them. */
function trend(scores: number[], size: number) {
  const recent = scores.slice(-size);
  const earlier = scores.slice(-2 * size, -size);
  const now = mean(recent);
  const before = mean(earlier);
  return now === null || before === null ? null : now - before;
}

export function progressReport(input: {
  events: Event[];
  startLevels: Partial<Record<PracticeSkill, PracticeLevel>>;
  currentLevels: Record<PracticeSkill, PracticeLevel>;
}) {
  return PRACTICE_SKILLS.map((skill) => {
    const scores = input.events
      .filter((e) => e.skill === skill)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((e) => e.scorePercent);
    const startLevel = input.startLevels[skill] ?? null;
    const currentLevel = input.currentLevels[skill];
    return {
      skill,
      attempts: scores.length,
      average: mean(scores),
      /** Points between the last three attempts and the three before. */
      trend: trend(scores, 3),
      startLevel,
      currentLevel,
      levelsGained:
        startLevel === null
          ? 0
          : Math.max(0, levelIndex(currentLevel) - levelIndex(startLevel)),
    };
  });
}
