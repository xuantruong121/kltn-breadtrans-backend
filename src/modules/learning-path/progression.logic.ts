/**
 * Progression rules for the internal practice levels (Mất gốc → Nâng cao):
 * how an attempt becomes a percentage, and when the next level opens. Levels
 * are practice bands, not CEFR levels or certificates. No Prisma, no I/O.
 */
import type { PracticeLevel } from '@prisma/client';

import { ABILITY_SEED, levelIndex, PRACTICE_LEVELS } from './placement.logic';

/** Owner decisions, 2026-10-31. */
export const GATE_QUESTIONS = 8;
export const GATE_MIN_QUESTIONS = 4;
export const GATE_PASS_PERCENT = 75;
export const GATE_COOLDOWN_HOURS = 24;
export const PROGRESS_ITEMS = 3;
export const PROGRESS_AVERAGE = 70;
/** Open to anyone without a placement, guests included. */
export const UNPLACED_UNLOCKED: PracticeLevel = 'BASIC';

type AttemptScore =
  /** Stored as the count of correct answers. */
  | { skill: 'LISTENING' | 'READING'; score: number | null; questions: number }
  /** Stored per task on its own scale; `aiFeedback` records that scale. */
  | { skill: 'WRITING'; score: number | null; aiFeedback: string | null }
  /** `overallScore`, 0-10. */
  | { skill: 'SPEAKING'; score: number | null };

const toPercent = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

function writingMaxScore(aiFeedback: string | null) {
  if (!aiFeedback) return null;
  try {
    const parsed = JSON.parse(aiFeedback) as { maxScore?: unknown };
    return typeof parsed.maxScore === 'number' && parsed.maxScore > 0
      ? parsed.maxScore
      : null;
  } catch {
    return null;
  }
}

/** An attempt on the common 0-100 scale; null when it has no usable score. */
export function percentOfAttempt(attempt: AttemptScore): number | null {
  if (attempt.score === null) return null;
  if (attempt.skill === 'SPEAKING') return toPercent(attempt.score * 10);
  if (attempt.skill === 'WRITING') {
    const max = writingMaxScore(attempt.aiFeedback);
    return max === null ? null : toPercent((attempt.score / max) * 100);
  }
  return attempt.questions > 0
    ? toPercent((attempt.score / attempt.questions) * 100)
    : null;
}

export const nextLevel = (level: PracticeLevel): PracticeLevel | null =>
  PRACTICE_LEVELS[levelIndex(level) + 1] ?? null;

export const isLevelLocked = (
  itemLevel: PracticeLevel,
  unlockedLevel: PracticeLevel,
) => levelIndex(itemLevel) > levelIndex(unlockedLevel);

export type ProgressEvent = { contentId: number; scorePercent: number };

/**
 * Progress at one level: distinct items done, and the average of the
 * learner's best items (their best score on each, top PROGRESS_ITEMS), so a
 * weak first try does not hold them back once they do better.
 */
export function levelProgress(events: ProgressEvent[]) {
  const { done, mean } = bestItems(events);
  return {
    done,
    needed: PROGRESS_ITEMS,
    average: mean === null ? null : Math.round(mean),
  };
}

function bestItems(events: ProgressEvent[]) {
  const best = new Map<number, number>();
  for (const e of events)
    best.set(e.contentId, Math.max(best.get(e.contentId) ?? 0, e.scorePercent));
  const top = [...best.values()].sort((a, b) => b - a).slice(0, PROGRESS_ITEMS);
  return {
    done: best.size,
    mean: top.length
      ? top.reduce((sum, value) => sum + value, 0) / top.length
      : null,
  };
}

/**
 * The level this progress opens, or null. The next level opens after
 * PROGRESS_ITEMS items at the current one averaging PROGRESS_AVERAGE, or once
 * the ability estimate reaches that level's seed.
 */
export function progressUnlockTarget(input: {
  unlockedLevel: PracticeLevel;
  ability: number;
  /** Attempts at `unlockedLevel`. */
  events: ProgressEvent[];
}): { level: PracticeLevel; reason: 'ITEMS' | 'ABILITY' } | null {
  const level = nextLevel(input.unlockedLevel);
  if (!level) return null;
  // The exact mean: 69.67 must not round up to a pass.
  const { done, mean } = bestItems(input.events);
  if (done >= PROGRESS_ITEMS && (mean ?? 0) >= PROGRESS_AVERAGE)
    return { level, reason: 'ITEMS' };
  if (input.ability >= ABILITY_SEED[level]) return { level, reason: 'ABILITY' };
  return null;
}

/**
 * The highest open level once empty levels are passed over: a level with no
 * published content cannot be progressed through, so the one after it opens.
 */
export function effectiveUnlockedLevel(
  unlockedLevel: PracticeLevel,
  levelsWithContent: ReadonlySet<PracticeLevel>,
): PracticeLevel {
  let level = unlockedLevel;
  for (;;) {
    const next = nextLevel(level);
    if (!next || levelsWithContent.has(level)) return level;
    level = next;
  }
}
