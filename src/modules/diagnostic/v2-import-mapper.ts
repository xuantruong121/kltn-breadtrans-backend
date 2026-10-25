/**
 * Pure mapping from the authored Entry Diagnostic V2 draft to the shapes the
 * existing persistence model accepts. No Prisma client, no I/O, no database:
 * these functions return plain payload objects so the mapping can be proved
 * before any row is written.
 *
 * The rule this module exists to enforce is that nothing is ever spread into a
 * create payload. `{ ...draftQuestion }` would silently carry authoring and
 * review metadata into canonical runtime content, which is exactly the hazard
 * the content guards were added for. Every field below is named explicitly, and
 * `assertNoAuthoringFields` fails closed if an unexpected key appears.
 *
 * Two schema capabilities the authored draft needs and the current model does
 * NOT have are recorded in `MAPPING_GAPS`. They are the reason live
 * persistence is not approved yet; see
 * artifacts/entry-diagnostic-v2-persistence-contract.md.
 */

/** Authoring and review fields that must never reach canonical content. */
export const AUTHORING_ONLY_FIELDS = [
  'answerRationale',
  'distractorRationales',
  'constructRationale',
  'wordGuidanceRationale',
  'wordGuidanceStatus',
  'diagnosticUse',
  'internalLabel',
  'targetSubskills',
  'targetEvidence',
  'difficultyRange',
  'draftKey',
  'mediaDraftKey',
  'passageDraftKey',
  'estimatedSeconds',
  'estimatedDurationSeconds',
  'estimatedReadingSeconds',
  'contextType',
  'localeIntent',
  'accentIntent',
  'speakerLabels',
  'speakerCount',
  'scriptSha256',
  'wordCount',
] as const;

/** Columns `DiagnosticQuestion` actually has, per prisma/schema.prisma. */
const QUESTION_COLUMNS = new Set([
  'assessmentId',
  'skill',
  'question',
  'options',
  'correctIndex',
  'explanation',
  'order',
  'taskType',
  'skillCode',
  'subskill',
  'intendedLevel',
  'difficulty',
  'instructions',
  'prepSeconds',
  'responseSeconds',
  'wordMin',
  'wordMax',
  'passageId',
  'rubricId',
]);

export type ObjectiveDraftItem = {
  draftKey: string;
  skill: string;
  taskType: string;
  subskill?: string;
  difficultyTier: string;
  order: number;
  prompt: string;
  options: string[];
  correctAnswer: string;
  answerRationale?: string;
  distractorRationales?: string[];
  mediaDraftKey?: string;
  passageDraftKey?: string;
};

export type ProductiveDraftItem = {
  draftKey: string;
  skill: string;
  taskType: string;
  subskill?: string;
  order: number;
  prompt: string;
  instructions?: string;
  prepSeconds?: number;
  responseSeconds?: number;
  wordMin?: number;
  wordMax?: number;
  rubricVersion?: string;
};

export type MappingContext = {
  assessmentId: number;
  /** draftKey -> persisted passage id, resolved before questions are created. */
  passageIds?: Readonly<Record<string, number>>;
  /** rubricVersion -> persisted rubric id. */
  rubricIds?: Readonly<Record<string, number>>;
};

export type QuestionCreatePayload = {
  assessmentId: number;
  skill: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  order: number;
  taskType: string;
  skillCode: string;
  subskill: string | null;
  /** Deliberately always null: see MAPPING_DECISIONS. */
  intendedLevel: null;
  difficulty: string | null;
  instructions: string | null;
  prepSeconds: number | null;
  responseSeconds: number | null;
  wordMin: number | null;
  wordMax: number | null;
  passageId: number | null;
  rubricId: number | null;
};

/**
 * Fails closed if a payload carries a key the schema does not have, or an
 * authoring field. Called by both mappers; also usable as a pre-write assertion.
 */
export function assertNoAuthoringFields(
  payload: Record<string, unknown>,
  label = 'payload',
): void {
  for (const key of Object.keys(payload)) {
    if ((AUTHORING_ONLY_FIELDS as readonly string[]).includes(key)) {
      throw new Error(
        `${label}: authoring-only field "${key}" must not be persisted`,
      );
    }
    if (!QUESTION_COLUMNS.has(key)) {
      throw new Error(`${label}: "${key}" is not a DiagnosticQuestion column`);
    }
  }
}

const SKILL_CODES: Readonly<Record<string, string>> = {
  LISTENING: 'LISTENING',
  READING: 'READING',
  SPEAKING: 'SPEAKING',
  WRITING: 'WRITING',
  LANGUAGE_USE: 'LANGUAGE_USE',
};

/** Legacy free-text `skill` label V1 rows use; kept so V1 stays readable. */
const LEGACY_SKILL_LABEL: Readonly<Record<string, string>> = {
  LISTENING: 'Listening',
  READING: 'Reading',
  SPEAKING: 'Speaking',
  WRITING: 'Writing',
  LANGUAGE_USE: 'Grammar',
};

export function mapObjectiveQuestion(
  item: ObjectiveDraftItem,
  ctx: MappingContext,
): QuestionCreatePayload {
  const correctIndex = item.options.indexOf(item.correctAnswer);
  if (correctIndex < 0) {
    throw new Error(`${item.draftKey}: correctAnswer is not one of options`);
  }
  if (item.options.filter((o) => o === item.correctAnswer).length !== 1) {
    throw new Error(`${item.draftKey}: correctAnswer is not unique in options`);
  }
  const skillCode = SKILL_CODES[item.skill];
  if (!skillCode)
    throw new Error(`${item.draftKey}: unknown skill "${item.skill}"`);

  let passageId: number | null = null;
  if (item.passageDraftKey) {
    const resolved = ctx.passageIds?.[item.passageDraftKey];
    if (resolved === undefined) {
      throw new Error(
        `${item.draftKey}: passageDraftKey "${item.passageDraftKey}" is unresolved`,
      );
    }
    passageId = resolved;
  }

  const payload: QuestionCreatePayload = {
    assessmentId: ctx.assessmentId,
    skill: LEGACY_SKILL_LABEL[item.skill] ?? item.skill,
    question: item.prompt,
    options: [...item.options],
    correctIndex,
    // Result-time only. Verified: sanitizeQuestion does not return it, and the
    // two sites that do are toResult and submitAssessment.
    explanation: item.answerRationale ?? null,
    order: item.order,
    taskType: item.taskType,
    skillCode,
    subskill: item.subskill ?? null,
    // The authored difficulty tier is a DESIGN HYPOTHESIS and must never land
    // in intendedLevel, which functions as a learner level.
    intendedLevel: null,
    difficulty: item.difficultyTier,
    instructions: null,
    prepSeconds: null,
    responseSeconds: null,
    wordMin: null,
    wordMax: null,
    passageId,
    rubricId: null,
  };
  assertNoAuthoringFields(payload, item.draftKey);
  return payload;
}

export function mapProductiveTask(
  item: ProductiveDraftItem,
  ctx: MappingContext,
): QuestionCreatePayload {
  const skillCode = SKILL_CODES[item.skill];
  if (!skillCode)
    throw new Error(`${item.draftKey}: unknown skill "${item.skill}"`);
  let rubricId: number | null = null;
  if (item.rubricVersion) {
    const resolved = ctx.rubricIds?.[item.rubricVersion];
    if (resolved === undefined) {
      throw new Error(
        `${item.draftKey}: rubricVersion "${item.rubricVersion}" is unresolved`,
      );
    }
    rubricId = resolved;
  }
  const payload: QuestionCreatePayload = {
    assessmentId: ctx.assessmentId,
    skill: LEGACY_SKILL_LABEL[item.skill] ?? item.skill,
    question: item.prompt,
    options: [],
    // -1 is the schema's documented sentinel for "no key". taskType is the
    // discriminator; correctIndex must not be used to infer item kind.
    correctIndex: -1,
    explanation: null,
    order: item.order,
    taskType: item.taskType,
    skillCode,
    subskill: item.subskill ?? null,
    intendedLevel: null,
    difficulty: null,
    instructions: item.instructions ?? null,
    prepSeconds: item.prepSeconds ?? null,
    responseSeconds: item.responseSeconds ?? null,
    wordMin: item.wordMin ?? null,
    wordMax: item.wordMax ?? null,
    passageId: null,
    rubricId,
  };
  assertNoAuthoringFields(payload, item.draftKey);
  return payload;
}

/* ------------------------------------------------------------------ *
 * Option identity under shuffle                                       *
 * ------------------------------------------------------------------ */

/**
 * The authored index is the canonical identity of an option. The runtime
 * permutation affects display order ONLY.
 *
 * `getAttemptQuestionPermutation` builds `permutation` such that display
 * position p shows authored option `permutation[p]` — this is how
 * `sanitizeQuestion` renders them (`permutation.map(idx => options[idx])`) and
 * how grading reads them back (`permutation[answer] === correctIndex`). So the
 * inverse is total and lossless, and no identity has to be inferred from
 * display text.
 */
export function authoredIndexFromDisplayed(
  permutation: readonly number[],
  displayedIndex: number,
): number {
  const authored = permutation[displayedIndex];
  if (authored === undefined) {
    throw new Error(
      `displayed index ${displayedIndex} is outside the permutation`,
    );
  }
  return authored;
}

/** Where the authored option currently sits on screen. */
export function displayedIndexFromAuthored(
  permutation: readonly number[],
  authoredIndex: number,
): number {
  const displayed = permutation.indexOf(authoredIndex);
  if (displayed < 0) {
    throw new Error(
      `authored index ${authoredIndex} is not in the permutation`,
    );
  }
  return displayed;
}

/**
 * The rationale belonging to the option shown at a display position. Resolved
 * through the authored index, never by position and never by text.
 */
export function rationaleForDisplayedOption(
  item: Pick<
    ObjectiveDraftItem,
    'options' | 'correctAnswer' | 'distractorRationales'
  >,
  permutation: readonly number[],
  displayedIndex: number,
): { optionText: string; rationale: string; isCorrect: boolean } {
  const authored = authoredIndexFromDisplayed(permutation, displayedIndex);
  const optionText = item.options[authored];
  const rationale = item.distractorRationales?.[authored] ?? '';
  return {
    optionText,
    rationale,
    isCorrect: optionText === item.correctAnswer,
  };
}

/** Schema capabilities the authored content needs and the model lacks. */
export const MAPPING_GAPS = [
  {
    id: 'GAP-1',
    field: 'draftKey',
    problem:
      'DiagnosticQuestion has no column for a stable authored source identity. ' +
      'Without one an import cannot be made idempotent: a re-run has nothing to ' +
      'match on except (assessmentId, order) or the question text, both of which ' +
      'change when content is revised.',
    blocksLivePersistence: true,
  },
  {
    id: 'GAP-2',
    field: 'distractorRationales',
    problem:
      'No column exists for per-option rationales. They are positional in the ' +
      'draft with a CORRECT marker at the key index, and the runtime permutes ' +
      'display order, so storing them positionally without the authored index ' +
      'would attach feedback to the wrong option.',
    blocksLivePersistence: false,
    decision:
      'Not persisted. They stay authoring and review metadata until a column ' +
      'with an explicit authored-index binding exists.',
  },
] as const;
