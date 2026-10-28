/**
 * FOUR_SKILL_PLACEMENT_V2 scorer, from the approved blueprint
 * (`artifacts/entry-diagnostic-v2-blueprint.json`, `scoring`):
 *
 *   Listening   = round(correct / items * 100)        weight 0.25
 *   Reading     = round(correct / items * 100)        weight 0.25
 *   Speaking    = round(mean(task rubric percent))    weight 0.25
 *   Writing     = round(mean(task rubric percent))    weight 0.25
 *   LanguageUse = round(correct / items * 100)        weight 0 (profile only)
 *   overall     = round((L + R + S + W) / 4), ONLY when all four are COMPLETE
 *
 * The per-skill profile is the primary result; the overall figure is a
 * secondary routing indicator. A pending, failed or skipped productive task
 * never scores 0 and never lets an overall figure be computed. No placement
 * band is produced: DEF-004 is decided as D1 (advisory scores only), so no
 * score is mapped to a named level and V1 thresholds are not borrowed.
 *
 * Pure: no Prisma, no I/O.
 */

import type { ObservedResult } from './diagnostic-observed-policy';
export const FOUR_SKILL_SCORING_VERSION = 'FOUR_SKILL_PLACEMENT_V2';

export const FOUR_SKILL_WEIGHTS = {
  LISTENING: 0.25,
  READING: 0.25,
  SPEAKING: 0.25,
  WRITING: 0.25,
  LANGUAGE_USE: 0,
} as const;

export type FourSkillKey = keyof typeof FOUR_SKILL_WEIGHTS;
export const REQUIRED_SKILLS: FourSkillKey[] = [
  'LISTENING',
  'READING',
  'SPEAKING',
  'WRITING',
];
export const OBJECTIVE_SKILLS: FourSkillKey[] = [
  'LISTENING',
  'READING',
  'LANGUAGE_USE',
];

/** Blueprint minimumEvidence.objectiveSkill. */
export const MIN_OBJECTIVE_ITEMS = 3;

/** Matches the persisted `DiagnosticCompletionState` enum. */
export type SkillState =
  'NOT_STARTED' | 'PENDING_GRADING' | 'COMPLETE' | 'GRADING_FAILED';

export type FourSkillSkillResult = {
  skill: FourSkillKey;
  state: SkillState;
  /** 0-100, rounded once. Null unless COMPLETE. */
  score: number | null;
  weight: number;
  itemsScored: number;
  itemsTotal: number;
  /**
   * Productive skills only: per-task status counts, so a learner can see
   * that a missing score comes from a skipped, pending or failed task and
   * not from a weak answer. Zero for objective skills.
   */
  tasksGraded: number;
  tasksPending: number;
  tasksFailed: number;
  tasksSkipped: number;
};

export type FourSkillResult = {
  scoringVersion: typeof FOUR_SKILL_SCORING_VERSION;
  /** COMPLETE only when all four required skills are COMPLETE. */
  state: 'COMPLETE' | 'PENDING_GRADING' | 'GRADING_FAILED' | 'NOT_STARTED';
  skills: Record<FourSkillKey, FourSkillSkillResult>;
  /** round((L+R+S+W)/4) when complete; otherwise null, never 0. */
  overall: number | null;
  placementBand: null;
  placementBandStatus: typeof PLACEMENT_BAND_STATUS;
  /**
   * Present for FOUR_SKILL_OBSERVED_V3 attempts: the observed score, the
   * objective core, coverage and per-task statuses. When present, `overall`,
   * `state` and the Speaking/Writing entries follow it (partial coverage
   * scored); older attempts keep the V2 meaning above.
   */
  observed?: ObservedResult;
};

/** DEF-004 decision: scores and advice only, never a named level. */
export const PLACEMENT_BAND_STATUS = 'D1_ADVISORY_SCORES_ONLY';

export type ObjectiveItemOutcome = {
  /** From the item's persisted section metadata, never from its skill label. */
  section: string | null | undefined;
  isCorrect: boolean;
};

export type ProductiveTaskOutcome = {
  questionId: number;
  status: string;
  /** Task rubric percentage (0-100), present when GRADED. */
  score: number | null | undefined;
};

const PENDING_TASK_STATES = new Set(['SUBMITTED', 'QUEUED', 'GRADING']);

function objectiveSkill(
  skill: FourSkillKey,
  items: ObjectiveItemOutcome[],
): FourSkillSkillResult {
  const own = items.filter((item) => item.section === skill);
  const correct = own.filter((item) => item.isCorrect).length;
  const complete = own.length >= MIN_OBJECTIVE_ITEMS;
  return {
    skill,
    state: complete ? 'COMPLETE' : 'NOT_STARTED',
    score: complete ? Math.round((correct / own.length) * 100) : null,
    weight: FOUR_SKILL_WEIGHTS[skill],
    itemsScored: correct,
    itemsTotal: own.length,
    tasksGraded: 0,
    tasksPending: 0,
    tasksFailed: 0,
    tasksSkipped: 0,
  };
}

function productiveSkill(
  skill: FourSkillKey,
  expectedQuestionIds: number[],
  tasks: ProductiveTaskOutcome[],
): FourSkillSkillResult {
  const byQuestion = new Map(tasks.map((task) => [task.questionId, task]));
  const graded: number[] = [];
  let pending = 0;
  let failed = 0;
  let skipped = 0;
  for (const id of expectedQuestionIds) {
    const task = byQuestion.get(id);
    if (
      task?.status === 'GRADED' &&
      typeof task.score === 'number' &&
      Number.isFinite(task.score)
    )
      graded.push(task.score);
    else if (task && PENDING_TASK_STATES.has(task.status)) pending += 1;
    else if (task?.status === 'GRADING_FAILED') failed += 1;
    else if (task?.status === 'SKIPPED') skipped += 1;
  }
  const complete =
    expectedQuestionIds.length > 0 &&
    graded.length === expectedQuestionIds.length;
  const state: SkillState = complete
    ? 'COMPLETE'
    : pending > 0
      ? 'PENDING_GRADING'
      : failed > 0
        ? 'GRADING_FAILED'
        : 'NOT_STARTED';
  return {
    skill,
    state,
    score: complete
      ? Math.round(
          graded.reduce((sum, value) => sum + value, 0) / graded.length,
        )
      : null,
    weight: FOUR_SKILL_WEIGHTS[skill],
    itemsScored: graded.length,
    itemsTotal: expectedQuestionIds.length,
    tasksGraded: graded.length,
    tasksPending: pending,
    tasksFailed: failed,
    tasksSkipped: skipped,
  };
}

export function scoreFourSkillPlacementV2(input: {
  objective: ObjectiveItemOutcome[];
  speakingQuestionIds: number[];
  speaking: ProductiveTaskOutcome[];
  writingQuestionIds: number[];
  writing: ProductiveTaskOutcome[];
}): FourSkillResult {
  const unknown = input.objective.filter(
    (item) => !OBJECTIVE_SKILLS.includes(item.section as FourSkillKey),
  );
  if (unknown.length) {
    throw new Error(
      `DIAGNOSTIC_SCORER_V2_UNSCORABLE: ${unknown.length} objective item(s) have no LISTENING/READING/LANGUAGE_USE section`,
    );
  }
  const skills: Record<FourSkillKey, FourSkillSkillResult> = {
    LISTENING: objectiveSkill('LISTENING', input.objective),
    READING: objectiveSkill('READING', input.objective),
    SPEAKING: productiveSkill(
      'SPEAKING',
      input.speakingQuestionIds,
      input.speaking,
    ),
    WRITING: productiveSkill(
      'WRITING',
      input.writingQuestionIds,
      input.writing,
    ),
    LANGUAGE_USE: objectiveSkill('LANGUAGE_USE', input.objective),
  };
  const required = REQUIRED_SKILLS.map((skill) => skills[skill]);
  const state: FourSkillResult['state'] = required.every(
    (s) => s.state === 'COMPLETE',
  )
    ? 'COMPLETE'
    : required.some((s) => s.state === 'PENDING_GRADING')
      ? 'PENDING_GRADING'
      : required.some((s) => s.state === 'GRADING_FAILED')
        ? 'GRADING_FAILED'
        : 'NOT_STARTED';
  // The overall is the weighted sum of the four required skills. Language Use
  // carries weight 0 by construction and is excluded explicitly as well.
  const overall =
    state === 'COMPLETE'
      ? Math.round(
          required.reduce((sum, s) => sum + (s.score as number) * s.weight, 0) /
            required.reduce((sum, s) => sum + s.weight, 0),
        )
      : null;
  return {
    scoringVersion: FOUR_SKILL_SCORING_VERSION,
    state,
    skills,
    overall,
    placementBand: null,
    placementBandStatus: PLACEMENT_BAND_STATUS,
  };
}
