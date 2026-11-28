export const MIN_DOMAIN_EVIDENCE = 3;

export function getAttemptQuestionPermutation(
  attemptId: number,
  questionId: number,
  optionCount: number,
): number[] {
  const indices = Array.from({ length: optionCount }, (_, i) => i);
  if (optionCount <= 1) return indices;
  let seed = (Math.abs(attemptId) * 10007 + questionId * 37) % 2147483647;
  for (let i = indices.length - 1; i > 0; i--) {
    seed = (seed * 16807 + 11) % 2147483647;
    const j = seed % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

/**
 * Display permutation for one learner on one assessment.
 *
 * Seeded by the authenticated learner and the assessment, never by an attempt
 * id. The attempt id is not known when the form is first served - it is
 * created by "start", after the learner has already received the questions -
 * so seeding by attempt made the order the learner saw (unpermuted) differ
 * from the order the grader assumed (permuted by the new attempt), and every
 * first attempt was graded against the wrong option. This seed is identical
 * before start, after start, on resume and on the result screen, and the
 * server derives it from the JWT subject, so the client cannot choose it.
 */
export function getLearnerQuestionPermutation(
  userId: number,
  assessmentId: number,
  questionId: number,
  optionCount: number,
): number[] {
  return getAttemptQuestionPermutation(
    learnerPermutationSeed(userId, assessmentId),
    questionId,
    optionCount,
  );
}

function learnerPermutationSeed(userId: number, assessmentId: number): number {
  return Math.abs(userId) * 100003 + Math.abs(assessmentId) * 7919 + 1;
}

/** Marker persisted on an attempt's answers naming how its options were displayed. */
export const LEARNER_PERMUTATION_SCHEME = 'LEARNER_ASSESSMENT_V1';

export type DiagnosticQuestionForScoring = {
  id: number;
  skill: string;
  question: string;
  options: unknown;
  correctIndex: number;
  explanation?: string | null;
  order: number;
  taskType?: string | null;
  instructions?: string | null;
  passageId?: number | null;
  rubricId?: number | null;
  prepSeconds?: number | null;
  responseSeconds?: number | null;
  wordMin?: number | null;
  wordMax?: number | null;
  /** Authored difficulty tier (D1-D4); content metadata only. */
  difficulty?: string | null;
  subskill?: string | null;
};

export type DiagnosticQuestionMeta = {
  values: string[];
  stableKey?: string;
  section?: string;
  construct?: string;
  questionType?: 'MCQ' | 'OPEN_TEXT';
  passageText?: string | null;
  audioGroup?: string | null;
  audioUrl?: string | null;
  activeInForm?: boolean;
};

/** True when `permutation` is a complete permutation of 0..optionCount-1. */
function isValidPermutation(
  permutation: unknown,
  optionCount: number,
): permutation is number[] {
  if (!Array.isArray(permutation) || permutation.length !== optionCount)
    return false;
  const seen = new Set<number>();
  for (const value of permutation) {
    if (!Number.isInteger(value) || value < 0 || value >= optionCount)
      return false;
    seen.add(value);
  }
  return seen.size === optionCount;
}

/**
 * Resolve a learner's answer to the AUTHORED option index, or null when it
 * cannot be resolved unambiguously. Never guesses.
 *
 * - A displayed index is translated through the server's display permutation.
 *   Without a valid permutation it is unresolvable: comparing a displayed index
 *   to an authored index is the defect this replaces, since it scores a wrong
 *   answer correct whenever the permutation moved the key.
 * - Option text identifies the option whatever order it was shown in, but only
 *   when exactly one option carries that text.
 * - A client-asserted `originalIndex` is not accepted: the authored identity of
 *   an option is the server's to derive, not the client's to declare.
 */
export function resolveAuthoredOptionIndex(
  question: DiagnosticQuestionForScoring,
  answer: unknown,
  permutation?: number[],
): number | null {
  if (isOpenDiagnosticQuestion(question)) return null;
  const options = getQuestionMeta(question).values;
  if (answer === undefined || answer === null) return null;

  const byText = (text: string): number | null => {
    const matches = options
      .map((option, index) => (option.trim() === text.trim() ? index : -1))
      .filter((index) => index >= 0);
    return matches.length === 1 ? matches[0] : null;
  };

  if (typeof answer === 'string') return byText(answer);

  let displayed: unknown = answer;
  if (typeof answer === 'object') {
    const raw = answer as Record<string, unknown>;
    if (typeof raw.text === 'string') return byText(raw.text);
    if (typeof raw.value === 'string') return byText(raw.value);
    displayed = raw.index;
  }

  if (
    typeof displayed !== 'number' ||
    !Number.isInteger(displayed) ||
    displayed < 0 ||
    displayed >= options.length
  )
    return null;
  if (!isValidPermutation(permutation, options.length)) return null;
  return permutation[displayed];
}

export function isDiagnosticAnswerCorrect(
  question: DiagnosticQuestionForScoring,
  answer: unknown,
  permutation?: number[],
): boolean {
  const authored = resolveAuthoredOptionIndex(question, answer, permutation);
  return authored !== null && authored === question.correctIndex;
}

export function getQuestionMeta(
  question: DiagnosticQuestionForScoring,
): DiagnosticQuestionMeta {
  if (Array.isArray(question.options))
    return {
      values: question.options.filter(
        (value): value is string => typeof value === 'string',
      ),
      questionType: 'MCQ',
    };
  if (!question.options || typeof question.options !== 'object')
    return { values: [], questionType: 'MCQ' };
  const raw = question.options as Record<string, unknown>;
  return {
    values: Array.isArray(raw.values)
      ? raw.values.filter((value): value is string => typeof value === 'string')
      : [],
    stableKey: typeof raw.stableKey === 'string' ? raw.stableKey : undefined,
    section: typeof raw.section === 'string' ? raw.section : undefined,
    construct: typeof raw.construct === 'string' ? raw.construct : undefined,
    questionType: raw.questionType === 'OPEN_TEXT' ? 'OPEN_TEXT' : 'MCQ',
    passageText: typeof raw.passageText === 'string' ? raw.passageText : null,
    audioGroup: typeof raw.audioGroup === 'string' ? raw.audioGroup : null,
    audioUrl: typeof raw.audioUrl === 'string' ? raw.audioUrl : null,
    activeInForm: raw.activeInForm !== false,
  };
}

export function getQuestionOptions(
  question: DiagnosticQuestionForScoring,
): string[] {
  return getQuestionMeta(question).values;
}

export function isOpenDiagnosticQuestion(
  question: DiagnosticQuestionForScoring,
): boolean {
  return getQuestionMeta(question).questionType === 'OPEN_TEXT';
}

export type DiagnosticSkillProfile = {
  skill: string;
  correctCount: number;
  totalCount: number;
  percentage: number | null;
  evidence: 'SUFFICIENT' | 'INSUFFICIENT';
};

export type DiagnosticTaskKind = 'OBJECTIVE' | 'SPEAKING' | 'WRITING';

/**
 * Classify by the persisted `taskType` column first. Legacy rows predate the
 * column's productive values and default to MCQ, so `options.questionType`
 * decides only when the column says nothing more specific.
 */
export function classifyDiagnosticTask(
  question: DiagnosticQuestionForScoring,
): DiagnosticTaskKind | 'INCONSISTENT' {
  const meta = getQuestionMeta(question);
  const taskType = question.taskType ?? 'MCQ';
  if (taskType === 'SPEAKING_RESPONSE')
    return meta.questionType === 'OPEN_TEXT' ? 'SPEAKING' : 'INCONSISTENT';
  if (taskType === 'WRITING_RESPONSE')
    return meta.questionType === 'OPEN_TEXT' ? 'WRITING' : 'INCONSISTENT';
  if (taskType === 'OPEN_TEXT' || meta.questionType === 'OPEN_TEXT') {
    if (meta.section === 'SPEAKING') return 'SPEAKING';
    if (meta.section === 'WRITING') return 'WRITING';
    return 'INCONSISTENT';
  }
  return 'OBJECTIVE';
}

const positiveInt = (value: unknown) =>
  Number.isInteger(value) && (value as number) > 0;

/**
 * Layer 1 - content structural validity: is the authored task complete and
 * internally consistent? Independent of audio, providers or activation.
 *
 * Each task kind is checked by its own rules. Productive tasks are never asked
 * for options, an answer key or a CEFR label: none of those exists for them,
 * and demanding one forced authors to fabricate it.
 */
export function validateDiagnosticContent(
  questions: DiagnosticQuestionForScoring[],
): string[] {
  const defects: string[] = [];
  const ids = new Set<number>();
  const orders = new Set<number>();
  for (const question of questions) {
    if (ids.has(question.id))
      defects.push(`duplicate question id ${question.id}`);
    ids.add(question.id);
    if (orders.has(question.order))
      defects.push(`duplicate order ${question.order}`);
    orders.add(question.order);
    if (!question.question?.trim()) defects.push(`empty prompt ${question.id}`);
    if (!question.skill?.trim()) defects.push(`missing skill ${question.id}`);

    const meta = getQuestionMeta(question);
    const kind = classifyDiagnosticTask(question);
    if (kind === 'INCONSISTENT') {
      defects.push(`inconsistent task type ${question.id}`);
      continue;
    }

    if (kind === 'OBJECTIVE') {
      if (meta.values.length < 2)
        defects.push(`invalid options ${question.id}`);
      if (new Set(meta.values.map((v) => v.trim())).size !== meta.values.length)
        defects.push(`duplicate option ${question.id}`);
      if (
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex >= meta.values.length
      )
        defects.push(`invalid correct index ${question.id}`);
      // Section-specific structure. Legacy items carry no section and are
      // plain text MCQs; these rules apply only where a section is declared.
      if (meta.section === 'LISTENING' && !meta.audioGroup)
        defects.push(`listening item without clip association ${question.id}`);
      if (meta.section === 'READING') {
        if (!meta.passageText?.trim())
          defects.push(`reading item without passage text ${question.id}`);
        if (question.passageId === null)
          defects.push(`reading item without passage reference ${question.id}`);
      }
      continue;
    }

    // Productive task.
    if (meta.values.length > 0)
      defects.push(`productive task carries options ${question.id}`);
    if (question.rubricId === null)
      defects.push(`productive task without rubric ${question.id}`);
    if (kind === 'SPEAKING') {
      if (meta.section !== 'SPEAKING')
        defects.push(`speaking task outside SPEAKING section ${question.id}`);
      if (
        question.prepSeconds !== undefined &&
        !positiveInt(question.prepSeconds)
      )
        defects.push(`invalid speaking prep time ${question.id}`);
      if (
        question.responseSeconds !== undefined &&
        !positiveInt(question.responseSeconds)
      )
        defects.push(`invalid speaking response time ${question.id}`);
    } else {
      if (meta.section !== 'WRITING')
        defects.push(`writing task outside WRITING section ${question.id}`);
      if (
        question.wordMin !== undefined &&
        question.wordMax !== undefined &&
        !(
          positiveInt(question.wordMin) &&
          positiveInt(question.wordMax) &&
          (question.wordMin as number) < (question.wordMax as number)
        )
      )
        defects.push(`invalid writing word bounds ${question.id}`);
    }
  }
  return defects;
}

/**
 * Layer 2 - runtime readiness: can each task actually be executed now? A DRAFT
 * may be structurally valid while this still reports work outstanding, which
 * is the correct state for content whose audio has not been produced.
 */
export function validateRuntimeReadiness(
  questions: DiagnosticQuestionForScoring[],
): string[] {
  const defects: string[] = [];
  for (const question of questions) {
    const meta = getQuestionMeta(question);
    if (meta.section === 'LISTENING' && !meta.audioUrl?.trim())
      defects.push(`missing listening audio ${question.id}`);
  }
  return defects;
}

/**
 * The gate the learner runtime enforces before serving, starting or scoring
 * an assessment: content AND runtime readiness. Kept under its existing name
 * so every call site keeps its fail-closed behaviour.
 */
export function validateQuestionBank(
  questions: DiagnosticQuestionForScoring[],
): string[] {
  return [
    ...validateDiagnosticContent(questions),
    ...validateRuntimeReadiness(questions),
  ];
}

export type DiagnosticReadinessReport = {
  content: { valid: boolean; defects: string[] };
  runtime: { ready: boolean; defects: string[] };
  activation: { ready: boolean; blockers: string[] };
};

/**
 * Layer 3 - activation readiness: may this assessment be exposed to learners?
 * Requires valid content, a runnable runtime, a scorer this build can run AND,
 * when it has Speaking or Writing tasks, a grader running against real
 * providers. A mock or unavailable grader, or an unstated one, blocks
 * activation. Passing content validation never implies READY or ACTIVE.
 */
export function evaluateAssessmentReadiness(
  assessment: { scoringVersion?: string | null; status?: string | null },
  questions: DiagnosticQuestionForScoring[],
  options: { productiveGraderMode?: 'real' | 'mock' | 'unavailable' } = {},
): DiagnosticReadinessReport {
  const content = validateDiagnosticContent(questions);
  const runtime = validateRuntimeReadiness(questions);
  const blockers: string[] = [];
  if (content.length) blockers.push(`content: ${content.length} defect(s)`);
  if (runtime.length) blockers.push(`runtime: ${runtime.length} defect(s)`);
  if (!questions.length) blockers.push('assessment has no questions');
  const hasProductive = questions.some((question) => {
    const kind = classifyDiagnosticTask(question);
    return kind === 'SPEAKING' || kind === 'WRITING';
  });
  if (hasProductive && options.productiveGraderMode !== 'real')
    blockers.push(
      `productive grader mode is ${options.productiveGraderMode ?? 'not stated'}; activation needs real providers`,
    );
  try {
    resolvePersistedScoringVersion(assessment.scoringVersion);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  return {
    content: { valid: content.length === 0, defects: content },
    runtime: { ready: runtime.length === 0, defects: runtime },
    activation: { ready: blockers.length === 0, blockers },
  };
}

export function buildSkillProfiles(
  questions: DiagnosticQuestionForScoring[],
  answers: Record<string, unknown>,
  permutations?: Record<number, number[]>,
): DiagnosticSkillProfile[] {
  const grouped = new Map<string, { correct: number; total: number }>();
  for (const question of questions) {
    const current = grouped.get(question.skill) ?? { correct: 0, total: 0 };
    current.total += 1;
    const answer = answers[String(question.id)];
    const perm = permutations?.[question.id];
    if (isDiagnosticAnswerCorrect(question, answer, perm)) {
      current.correct += 1;
    }
    grouped.set(question.skill, current);
  }
  return [...grouped.entries()].map(([skill, value]) => ({
    skill,
    correctCount: value.correct,
    totalCount: value.total,
    percentage:
      value.total >= MIN_DOMAIN_EVIDENCE
        ? Math.round((value.correct / value.total) * 100)
        : null,
    evidence:
      value.total >= MIN_DOMAIN_EVIDENCE ? 'SUFFICIENT' : 'INSUFFICIENT',
  }));
}

/**
 * Describe the form that was actually administered, from its own items, so a
 * result never states a size or structure the learner did not take.
 */
export function describeAdministeredForm(
  questions: DiagnosticQuestionForScoring[],
) {
  const objective = questions.filter(
    (question) => !isOpenDiagnosticQuestion(question),
  );
  const bySkill: Record<string, number> = {};
  for (const question of questions) {
    bySkill[question.skill] = (bySkill[question.skill] ?? 0) + 1;
  }
  return {
    totalItems: questions.length,
    objectiveCount: objective.length,
    productiveCount: questions.length - objective.length,
    itemsBySkill: bySkill,
  };
}

/**
 * The scoring version persisted on an assessment and pinned on each attempt.
 * FOUR_SKILL_PLACEMENT_V2 is the only one this build runs. The earlier
 * versions (a pooled 20-item score and a section/band score) were removed;
 * a row that still names one fails closed in resolvePersistedScoringVersion.
 */
export type DiagnosticScoringVersion = 'FOUR_SKILL_PLACEMENT_V2';

export const SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS = [
  'FOUR_SKILL_PLACEMENT_V2',
] as const satisfies readonly DiagnosticScoringVersion[];

/**
 * Resolve the scorer for an assessment from its PERSISTED version.
 *
 * Deliberately takes only the stored version string: no id, title, question
 * count, skill label or item metadata is in scope, so none of them can change
 * which algorithm runs (DIAG-002 and DIAG-008).
 */
export function resolvePersistedScoringVersion(
  persisted: string | null | undefined,
): DiagnosticScoringVersion {
  const value = (persisted ?? '').trim();
  if (!value) {
    throw new Error(
      'DIAGNOSTIC_SCORER_UNSUPPORTED: assessment has no persisted scoringVersion',
    );
  }
  if (
    (SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS as readonly string[]).includes(value)
  ) {
    return value as DiagnosticScoringVersion;
  }
  throw new Error(
    `DIAGNOSTIC_SCORER_UNSUPPORTED: unknown scoringVersion "${value}"`,
  );
}
