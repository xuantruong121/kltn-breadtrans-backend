/**
 * Owner access policy for STANDALONE skill practice (Listening, Reading,
 * Speaking, Writing), decided from the content's CEFR level:
 *   A1 / A2  → free for every learner;
 *   B1 and above → PLUS (PRO includes PLUS).
 * Learner-facing groups: Cơ bản (A1–A2), Trung cấp (B1–B2), Nâng cao (C1–C2).
 *
 * Levels come from authored data: a Speaking practice set's `level`, or the
 * explicit CEFR tag the content team writes at the start of a practice title
 * ("Listening B1 — …", "Reading A1–A2 — …", "Nghe chép A2 — …"). Only that
 * tag before the " — " separator is read; anything else is "unknown", which
 * callers must never treat as free.
 */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];
export type CefrRange = { min: Cefr; max: Cefr };
export type LevelGroup = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED';

const rank = (level: Cefr) => CEFR_LEVELS.indexOf(level);
const TAG = /\b([ABC][12])(?:\s*[–-]\s*([ABC][12]))?\b/;

/** "B1", "A1–A2", "B1-C1" → range; null when no explicit tag. */
export function parseCefrRange(
  value: string | null | undefined,
): CefrRange | null {
  if (!value) return null;
  // A title carries its tag in the head ("Listening B1 — Work"); a level
  // field ("A1-A2") has no separator, so the whole value is the head.
  const head = value.split(' — ')[0];
  const match = TAG.exec(head.toUpperCase());
  if (!match) return null;
  const a = match[1] as Cefr;
  const b = (match[2] ?? match[1]) as Cefr;
  return rank(a) <= rank(b) ? { min: a, max: b } : { min: b, max: a };
}

/** True when any part of the range is B1 or above. */
export function practiceRequiresPlus(range: CefrRange): boolean {
  return rank(range.max) >= rank('B1');
}

const groupOf = (level: Cefr): LevelGroup =>
  rank(level) <= 1 ? 'BASIC' : rank(level) <= 3 ? 'INTERMEDIATE' : 'ADVANCED';

/** The single learner-facing group, or null when the range spans two. */
export function levelGroup(range: CefrRange): LevelGroup | null {
  const group = groupOf(range.min);
  return group === groupOf(range.max) ? group : null;
}

export const LEVEL_GROUP_LABEL: Record<LevelGroup, string> = {
  BASIC: 'Cơ bản',
  INTERMEDIATE: 'Trung cấp',
  ADVANCED: 'Nâng cao',
};

/** Speaking `difficulty` values used by the catalog filters. */
export const LEVEL_GROUP_DIFFICULTY: Record<LevelGroup, string> = {
  BASIC: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
};

/** "Cơ bản · A1–A2", "Trung cấp · B1"; null for a mixed or unknown range. */
export function levelLabel(range: CefrRange | null): string | null {
  if (!range) return null;
  const group = levelGroup(range);
  if (!group) return null;
  const span =
    range.min === range.max ? range.min : `${range.min}–${range.max}`;
  return `${LEVEL_GROUP_LABEL[group]} · ${span}`;
}
