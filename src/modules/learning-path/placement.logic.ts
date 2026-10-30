/**
 * Placement: Entry Diagnostic skill scores -> internal practice levels.
 *
 * Owner decision 2026-10-30 (replaces DEF-004 "advisory scores only"): the
 * learner gets a "mức luyện tập đề xuất" per skill and overall, one of four
 * internal levels. They are BreadTrans practice levels, not CEFR levels and
 * not a certificate, and nothing here maps them to CEFR.
 *
 * The thresholds are a design hypothesis on the diagnostic's 0-100 skill
 * score, to be revisited with real data. Pure: no Prisma, no I/O.
 */
import type { PracticeLevel, PracticeSkill } from '@prisma/client';

export const PRACTICE_LEVELS: readonly PracticeLevel[] = [
  'STARTER',
  'BASIC',
  'INTERMEDIATE',
  'ADVANCED',
];

export const PRACTICE_SKILLS: readonly PracticeSkill[] = [
  'LISTENING',
  'READING',
  'SPEAKING',
  'WRITING',
];

export const PRACTICE_LEVEL_LABEL: Record<PracticeLevel, string> = {
  STARTER: 'Mất gốc',
  BASIC: 'Cơ bản',
  INTERMEDIATE: 'Trung cấp',
  ADVANCED: 'Nâng cao',
};

/** Lowest score (inclusive) for each level above STARTER. */
export const PLACEMENT_THRESHOLDS = {
  BASIC: 30,
  INTERMEDIATE: 55,
  ADVANCED: 75,
} as const;

export const levelIndex = (level: PracticeLevel) =>
  PRACTICE_LEVELS.indexOf(level);

export const maxLevel = (a: PracticeLevel, b: PracticeLevel): PracticeLevel =>
  levelIndex(a) >= levelIndex(b) ? a : b;

/** Levels from STARTER up to and including `level`. */
export const levelsUpTo = (level: PracticeLevel): PracticeLevel[] =>
  PRACTICE_LEVELS.slice(0, levelIndex(level) + 1);

export function levelFromScore(score: number): PracticeLevel {
  if (score >= PLACEMENT_THRESHOLDS.ADVANCED) return 'ADVANCED';
  if (score >= PLACEMENT_THRESHOLDS.INTERMEDIATE) return 'INTERMEDIATE';
  if (score >= PLACEMENT_THRESHOLDS.BASIC) return 'BASIC';
  return 'STARTER';
}

/**
 * Starting ability (logit scale) for the Elo-style model of F6: the typical
 * difficulty of the level's own content (ability.logic CEFR_DIFFICULTY:
 * A1 -1.25, A2 -0.5, B1/B2 ~0.6, C1 1.6) plus 0.75, so an item at the
 * learner's level starts near the 68 % predicted success the recommender
 * aims for. Measured on the harness 2026-10-30: the first seeds (-1.5 ...)
 * gave a Mất gốc learner 44 % on A1 items.
 */
export const ABILITY_SEED: Record<PracticeLevel, number> = {
  STARTER: -0.5,
  BASIC: 0.25,
  INTERMEDIATE: 1.3,
  ADVANCED: 2.35,
};

export type SkillScores = Partial<Record<PracticeSkill, number | null>>;

export type Placement = {
  /** Null for a skill that has no completed score. */
  skills: Record<PracticeSkill, PracticeLevel | null>;
  /** Median of the placed skills (lower median on a tie); null if none. */
  overall: PracticeLevel | null;
  /** True when fewer than four skills were placed. */
  partial: boolean;
};

export function placeFromScores(scores: SkillScores): Placement {
  const skills = Object.fromEntries(
    PRACTICE_SKILLS.map((skill) => {
      const score = scores[skill];
      return [
        skill,
        typeof score === 'number' && Number.isFinite(score)
          ? levelFromScore(score)
          : null,
      ];
    }),
  ) as Record<PracticeSkill, PracticeLevel | null>;
  const placed = PRACTICE_SKILLS.map((s) => skills[s])
    .filter((l): l is PracticeLevel => l !== null)
    .sort((a, b) => levelIndex(a) - levelIndex(b));
  return {
    skills,
    overall: placed.length ? placed[Math.floor((placed.length - 1) / 2)] : null,
    partial: placed.length < PRACTICE_SKILLS.length,
  };
}
