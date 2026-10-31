/**
 * Elo-style ability / difficulty model (F6), after Duolingo's Birdbrain: each
 * learner has an ability per skill (theta) and each practice item a
 * difficulty (b), both on a logit scale. The predicted chance of success is
 * p = 1 / (1 + e^(b - theta)). After a graded attempt with outcome o in [0, 1]
 * both move by the surprise (o - p): theta up and b down when the learner did
 * better than expected. Items whose p lies in the target band are the ones
 * the recommender prefers. Pure: no I/O.
 */
import type { PracticeLevel } from '@prisma/client';

import type { Cefr, CefrRange } from '../subscription/practice-level';

/** Preferred predicted success: challenging but achievable. */
export const TARGET_SUCCESS = { min: 0.6, max: 0.8, centre: 0.7 } as const;

const LEARNER_K = 0.4;
const ITEM_K = 0.15;

/** Difficulty seed per CEFR tag on the content (a content label only). */
export const CEFR_DIFFICULTY: Record<Cefr, number> = {
  A1: -1.25,
  A2: -0.5,
  B1: 0.25,
  B2: 0.9,
  C1: 1.6,
  C2: 2.2,
};

/** The practice level an item belongs to, from its tag (lowest of a range). */
export function itemLevel(range: CefrRange): PracticeLevel {
  const min = range.min;
  if (min === 'A1') return 'STARTER';
  if (min === 'A2') return 'BASIC';
  if (min === 'B1' || min === 'B2') return 'INTERMEDIATE';
  return 'ADVANCED';
}

export function seedDifficulty(range: CefrRange): number {
  return (CEFR_DIFFICULTY[range.min] + CEFR_DIFFICULTY[range.max]) / 2;
}

export function successProbability(ability: number, difficulty: number) {
  return 1 / (1 + Math.exp(difficulty - ability));
}

/**
 * New ability and difficulty after one graded attempt. `scorePercent` is the
 * attempt's 0-100 score. The item moves less as it collects attempts, so one
 * learner cannot swing a shared difficulty.
 */
export function updateAfterAttempt(input: {
  ability: number;
  difficulty: number;
  itemAttempts: number;
  scorePercent: number;
}): { ability: number; difficulty: number; expected: number } {
  const outcome = Math.min(1, Math.max(0, input.scorePercent / 100));
  const expected = successProbability(input.ability, input.difficulty);
  const surprise = outcome - expected;
  const itemK = ITEM_K / Math.sqrt(1 + Math.max(0, input.itemAttempts));
  return {
    ability: input.ability + LEARNER_K * surprise,
    difficulty: input.difficulty - itemK * surprise,
    expected,
  };
}

/** 1 at the centre of the target band, falling to 0 at p = 0 or 1. */
export function fitScore(p: number): number {
  const c = TARGET_SUCCESS.centre;
  return Math.max(0, 1 - Math.abs(p - c) / (p < c ? c : 1 - c));
}
