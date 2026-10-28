/**
 * FOUR_SKILL_OBSERVED_V3 — the CP60-DIAG result policy for the four-skill
 * Entry Diagnostic (owner decision, CP60-DIAG §4–§5).
 *
 * BreadTrans design weights, not a psychometric or CEFR standard:
 *
 *   Listening 35%, Reading 35%, each Speaking task 7.5%, each Writing task 7.5%
 *
 *   objectiveCore = (0.35 L + 0.35 R) / 0.70
 *   observed      = (0.35 L + 0.35 R + Σ 0.075 · taskScore) / (0.70 + 0.075 · |graded|)
 *
 * Only GRADED productive tasks enter the observed score. A skipped (or never
 * answered) task adds neither score nor weight; a graded zero adds its weight;
 * a pending or failed task withholds the observed score instead of being
 * dropped or counted as zero. Language Use items stay a weight-0 profile.
 *
 * The policy is chosen per attempt from the persisted `__resultPolicy` marker
 * (see readResultPolicy). Attempts without it keep FOUR_SKILL_PLACEMENT_V2.
 *
 * Rounding: every score is computed in full precision and rounded once, to
 * one decimal, by `round1` when it leaves this module.
 *
 * Pure: no Prisma, no I/O.
 */

export const OBSERVED_RESULT_POLICY = 'FOUR_SKILL_OBSERVED_V3';
export const RESULT_POLICY_ANSWER_KEY = '__resultPolicy';

export const OBJECTIVE_WEIGHTS = { LISTENING: 0.35, READING: 0.35 } as const;
export const PRODUCTIVE_TASK_WEIGHT = 0.075;
export const OBJECTIVE_WEIGHT_TOTAL =
  OBJECTIVE_WEIGHTS.LISTENING + OBJECTIVE_WEIGHTS.READING;

/** Blueprint minimumEvidence.objectiveSkill (unchanged from V2). */
export const MIN_OBJECTIVE_ITEMS = 3;

/**
 * Rubric criterion weights for this policy (owner decision §6, §7). Keys are
 * the criterion keys of SPK_RUBRIC_V3 / WRT_RUBRIC_V3.
 *   Speaking: task fulfilment 30, grammar & vocabulary (language_use) 25,
 *             coherence & fluency 25, intelligibility & pronunciation 20.
 *   Writing:  task achievement 30, grammar 25, vocabulary 20, organisation 25.
 */
export const RUBRIC_WEIGHTING_VERSION = 'DIAG_RUBRIC_WEIGHTS_V1';
export const RUBRIC_CRITERION_WEIGHTS: Record<
  'SPEAKING' | 'WRITING',
  Record<string, number>
> = {
  SPEAKING: {
    task_fulfilment: 0.3,
    language_use: 0.25,
    fluency: 0.25,
    intelligibility: 0.2,
  },
  WRITING: {
    task_achievement: 0.3,
    grammar: 0.25,
    vocabulary: 0.2,
    organisation: 0.25,
  },
};

/**
 * Speaking criteria that need acoustic evidence. Without it they are
 * UNAVAILABLE: never full credit, zero or a midpoint.
 */
export const ACOUSTIC_CRITERIA = ['intelligibility', 'fluency'] as const;

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function readResultPolicy(answers: unknown): string | null {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    return null;
  const value = (answers as Record<string, unknown>)[RESULT_POLICY_ANSWER_KEY];
  return typeof value === 'string' ? value : null;
}

// ------------------------------------------------------------ task percentage

export type RubricCriterionRange = { key: string; min: number; max: number };

export type WeightedTaskScore = {
  /** 0-100 over the AVAILABLE criteria; null when none is available. */
  percentage: number | null;
  unavailableCriteria: string[];
  /** Sum of the weights actually assessed (1 when nothing is unavailable). */
  assessedWeight: number;
  weightingVersion: typeof RUBRIC_WEIGHTING_VERSION;
};

/**
 * Weighted rubric percentage. A criterion with a null score is unavailable;
 * its weight is left out of both numerator and denominator, and it is listed
 * so the result cannot be read as a full-rubric score.
 */
export function weightedTaskPercentage(
  skill: 'SPEAKING' | 'WRITING',
  criteria: RubricCriterionRange[],
  scores: Record<string, number | null>,
): WeightedTaskScore {
  const weights = RUBRIC_CRITERION_WEIGHTS[skill];
  const missing = criteria.filter((c) => weights[c.key] === undefined);
  if (missing.length)
    throw new Error(
      `DIAGNOSTIC_RUBRIC_WEIGHT_MISSING: ${skill} criterion ${missing[0].key} has no weight`,
    );
  let numerator = 0;
  let assessedWeight = 0;
  const unavailableCriteria: string[] = [];
  for (const c of criteria) {
    const score = scores[c.key];
    if (score === null || score === undefined) {
      unavailableCriteria.push(c.key);
      continue;
    }
    numerator += weights[c.key] * ((score - c.min) / (c.max - c.min));
    assessedWeight += weights[c.key];
  }
  return {
    percentage: assessedWeight > 0 ? (numerator / assessedWeight) * 100 : null,
    unavailableCriteria,
    assessedWeight: Math.round(assessedWeight * 1000) / 1000,
    weightingVersion: RUBRIC_WEIGHTING_VERSION,
  };
}

// ------------------------------------------------------------- attempt score

export type ProductiveTaskStatus =
  | 'NOT_ATTEMPTED'
  | 'SKIPPED'
  | 'SUBMITTED'
  | 'GRADING_PENDING'
  | 'GRADED'
  | 'GRADING_FAILED';

/** Persisted row statuses (Speaking strings, Writing enum) to the contract. */
export function normalizeTaskStatus(
  raw: string | null | undefined,
): ProductiveTaskStatus {
  switch (raw) {
    case 'GRADED':
      return 'GRADED';
    case 'GRADING_FAILED':
      return 'GRADING_FAILED';
    case 'SKIPPED':
      return 'SKIPPED';
    case 'SUBMITTED':
      return 'SUBMITTED';
    case 'QUEUED':
    case 'GRADING':
      return 'GRADING_PENDING';
    default:
      // NOT_STARTED, NOT_SUBMITTED, a missing row or an unknown status: no
      // answer exists that could be graded.
      return 'NOT_ATTEMPTED';
  }
}

export type ObjectiveOutcome = {
  section: string | null | undefined;
  isCorrect: boolean;
};

export type ProductiveOutcome = {
  questionId: number;
  status: string | null | undefined;
  score: number | null | undefined;
};

export type ObservedSkill = {
  skill: 'LISTENING' | 'READING' | 'LANGUAGE_USE';
  correct: number;
  total: number;
  /** 0-100, one decimal; null when fewer than MIN_OBJECTIVE_ITEMS. */
  score: number | null;
  weight: number;
};

export type ObservedTask = {
  questionId: number;
  order: 1 | 2;
  status: ProductiveTaskStatus;
  score: number | null;
  weight: number;
};

export type ObservedProductiveSkill = {
  skill: 'SPEAKING' | 'WRITING';
  tasks: ObservedTask[];
  graded: number;
  total: number;
  skipped: number;
  pending: number;
  failed: number;
  /** Mean of the GRADED tasks; null when none is graded. */
  score: number | null;
  /** 'NONE' (0 graded), 'PARTIAL' (some), 'FULL' (all). */
  coverage: 'NONE' | 'PARTIAL' | 'FULL';
};

export type ObservedResult = {
  policyVersion: typeof OBSERVED_RESULT_POLICY;
  rubricWeightingVersion: typeof RUBRIC_WEIGHTING_VERSION;
  weights: {
    LISTENING: number;
    READING: number;
    SPEAKING_TASK: number;
    WRITING_TASK: number;
  };
  listening: ObservedSkill;
  reading: ObservedSkill;
  /** Weight 0: shown as supporting evidence, never scored. */
  languageUse: ObservedSkill;
  speaking: ObservedProductiveSkill;
  writing: ObservedProductiveSkill;
  /** (0.35L + 0.35R)/0.70; null without both objective skills. */
  objectiveCore: number | null;
  observed: {
    /** Null while withheld (see `withheldReason`). */
    score: number | null;
    numerator: number | null;
    denominator: number;
    gradedProductiveTasks: number;
    withheldReason:
      | null
      | 'OBJECTIVE_INCOMPLETE'
      | 'PRODUCTIVE_PENDING'
      | 'PRODUCTIVE_FAILED';
  };
  /** Weight of the evidence used, out of 1.00. */
  coverageWeight: number;
};

function objective(
  skill: ObservedSkill['skill'],
  items: ObjectiveOutcome[],
  weight: number,
): ObservedSkill {
  const own = items.filter((item) => item.section === skill);
  const correct = own.filter((item) => item.isCorrect).length;
  return {
    skill,
    correct,
    total: own.length,
    score:
      own.length >= MIN_OBJECTIVE_ITEMS
        ? round1((correct / own.length) * 100)
        : null,
    weight,
  };
}

function productive(
  skill: 'SPEAKING' | 'WRITING',
  questionIds: number[],
  rows: ProductiveOutcome[],
): ObservedProductiveSkill {
  const byId = new Map(rows.map((row) => [row.questionId, row]));
  const tasks: ObservedTask[] = questionIds.map((questionId, index) => {
    const row = byId.get(questionId);
    let status = normalizeTaskStatus(row?.status);
    const score =
      status === 'GRADED' &&
      typeof row?.score === 'number' &&
      Number.isFinite(row.score)
        ? row.score
        : null;
    // A GRADED row without a usable score cannot be trusted as graded.
    if (status === 'GRADED' && score === null) status = 'GRADING_FAILED';
    if (score !== null && (score < 0 || score > 100))
      throw new Error(
        `DIAGNOSTIC_TASK_SCORE_OUT_OF_RANGE: ${skill} question ${questionId} = ${score}`,
      );
    return {
      questionId,
      order: (index + 1) as 1 | 2,
      status,
      score: score === null ? null : round1(score),
      weight: PRODUCTIVE_TASK_WEIGHT,
    };
  });
  const graded = tasks.filter((t) => t.status === 'GRADED');
  const count = (s: ProductiveTaskStatus[]) =>
    tasks.filter((t) => s.includes(t.status)).length;
  return {
    skill,
    tasks,
    graded: graded.length,
    total: tasks.length,
    skipped: count(['SKIPPED', 'NOT_ATTEMPTED']),
    pending: count(['SUBMITTED', 'GRADING_PENDING']),
    failed: count(['GRADING_FAILED']),
    score: graded.length
      ? round1(
          graded.reduce((sum, t) => sum + (t.score as number), 0) /
            graded.length,
        )
      : null,
    coverage:
      graded.length === 0
        ? 'NONE'
        : graded.length === tasks.length
          ? 'FULL'
          : 'PARTIAL',
  };
}

export function scoreObservedV3(input: {
  objective: ObjectiveOutcome[];
  speakingQuestionIds: number[];
  speaking: ProductiveOutcome[];
  writingQuestionIds: number[];
  writing: ProductiveOutcome[];
}): ObservedResult {
  const known = ['LISTENING', 'READING', 'LANGUAGE_USE'];
  const unknown = input.objective.filter(
    (item) => !known.includes(String(item.section)),
  );
  if (unknown.length)
    throw new Error(
      `DIAGNOSTIC_SCORER_V3_UNSCORABLE: ${unknown.length} objective item(s) have no LISTENING/READING/LANGUAGE_USE section`,
    );
  const listening = objective(
    'LISTENING',
    input.objective,
    OBJECTIVE_WEIGHTS.LISTENING,
  );
  const reading = objective(
    'READING',
    input.objective,
    OBJECTIVE_WEIGHTS.READING,
  );
  const languageUse = objective('LANGUAGE_USE', input.objective, 0);
  const speaking = productive(
    'SPEAKING',
    input.speakingQuestionIds,
    input.speaking,
  );
  const writing = productive(
    'WRITING',
    input.writingQuestionIds,
    input.writing,
  );

  const objectiveReady = listening.score !== null && reading.score !== null;
  // Full precision inside; rounded only on the way out.
  const L = objectiveReady ? listening.correct / listening.total : 0;
  const R = objectiveReady ? reading.correct / reading.total : 0;
  const objectiveNumerator =
    (OBJECTIVE_WEIGHTS.LISTENING * L + OBJECTIVE_WEIGHTS.READING * R) * 100;

  const gradedTasks = [...speaking.tasks, ...writing.tasks].filter(
    (t) => t.status === 'GRADED',
  );
  const pending = speaking.pending + writing.pending;
  const failed = speaking.failed + writing.failed;
  const denominator =
    OBJECTIVE_WEIGHT_TOTAL + PRODUCTIVE_TASK_WEIGHT * gradedTasks.length;
  const numerator =
    objectiveNumerator +
    gradedTasks.reduce(
      (sum, t) => sum + PRODUCTIVE_TASK_WEIGHT * (t.score as number),
      0,
    );
  const withheldReason: ObservedResult['observed']['withheldReason'] =
    !objectiveReady
      ? 'OBJECTIVE_INCOMPLETE'
      : pending > 0
        ? 'PRODUCTIVE_PENDING'
        : failed > 0
          ? 'PRODUCTIVE_FAILED'
          : null;

  return {
    policyVersion: OBSERVED_RESULT_POLICY,
    rubricWeightingVersion: RUBRIC_WEIGHTING_VERSION,
    weights: {
      LISTENING: OBJECTIVE_WEIGHTS.LISTENING,
      READING: OBJECTIVE_WEIGHTS.READING,
      SPEAKING_TASK: PRODUCTIVE_TASK_WEIGHT,
      WRITING_TASK: PRODUCTIVE_TASK_WEIGHT,
    },
    listening,
    reading,
    languageUse,
    speaking,
    writing,
    objectiveCore: objectiveReady
      ? round1(objectiveNumerator / OBJECTIVE_WEIGHT_TOTAL)
      : null,
    observed: {
      score: withheldReason === null ? round1(numerator / denominator) : null,
      numerator:
        withheldReason === null ? Math.round(numerator * 1000) / 1000 : null,
      denominator: Math.round(denominator * 1000) / 1000,
      gradedProductiveTasks: gradedTasks.length,
      withheldReason,
    },
    coverageWeight: objectiveReady ? Math.round(denominator * 1000) / 1000 : 0,
  };
}

// ------------------------------------------------------ objective breakdown

export type BreakdownGroup = { key: string; correct: number; total: number };
export type ObjectiveBreakdown = Record<
  'LISTENING' | 'READING' | 'LANGUAGE_USE',
  { byDifficulty: BreakdownGroup[]; bySubskill: BreakdownGroup[] }
>;

/**
 * Correct/total per authored difficulty tier (D1-D4: design hypotheses of the
 * item writers, NOT CEFR levels) and per assessed subskill, for each
 * objective section. Only what the items carry is reported; nothing is
 * inferred from a single item beyond its own group.
 */
export function buildObjectiveBreakdown(
  items: Array<{
    section: string | null | undefined;
    difficulty: string | null | undefined;
    subskill: string | null | undefined;
    isCorrect: boolean;
  }>,
): ObjectiveBreakdown {
  const group = (rows: typeof items, by: 'difficulty' | 'subskill') => {
    const map = new Map<string, BreakdownGroup>();
    for (const row of rows) {
      const key = row[by] ?? 'UNSPECIFIED';
      const g = map.get(key) ?? { key, correct: 0, total: 0 };
      g.total += 1;
      if (row.isCorrect) g.correct += 1;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  };
  const out = {} as ObjectiveBreakdown;
  for (const section of ['LISTENING', 'READING', 'LANGUAGE_USE'] as const) {
    const own = items.filter((i) => i.section === section);
    out[section] = {
      byDifficulty: group(own, 'difficulty'),
      bySubskill: group(own, 'subskill'),
    };
  }
  return out;
}
