/**
 * Pure productive-task rules for the Entry Diagnostic: recording duration,
 * writing length, rubric parsing and validation of grader output. No Prisma,
 * no I/O, so every rule is unit-testable and shared by service and worker.
 */
import type { DiagnosticQuestionForScoring } from './diagnostic.logic';

// ------------------------------------------------------------ speaking time

/** Shortest recording accepted at all. Unchanged from the pre-C2 floor. */
export const SPEAKING_MIN_DURATION_MS = 300;

/**
 * Codec allowance. Measured in C2 by encoding exact-length tones in every
 * accepted container and decoding them through the real normalizer: Opus
 * (webm, ogg) and WAV drift 0 ms, AAC (m4a) at most +13 ms from its priming
 * frames. 50 ms covers that with margin.
 */
export const SPEAKING_CODEC_TOLERANCE_MS = 50;

/**
 * Allowance for the browser stopping MediaRecorder a moment after the task
 * timer expires and flushing its last chunk. NOT measured: no browser was run
 * in C2. It must be confirmed by the browser E2E phase and tightened if the
 * observed latency is lower.
 */
export const SPEAKING_CAPTURE_STOP_ALLOWANCE_MS = 500;

/**
 * How far the client's reported duration may differ from the decoded one.
 * The client timer ticks every 100 ms and starts before the first chunk;
 * anything beyond this is a contradiction, not jitter.
 */
export const SPEAKING_CLIENT_MISMATCH_TOLERANCE_MS = 1500;

export type SpeakingDurationPolicy = {
  configuredResponseMs: number;
  minMs: number;
  maxMs: number;
};

/**
 * The response limit comes from the task row's `responseSeconds`, which is
 * server-owned. `prepSeconds` is thinking time and is never added to it. A
 * speaking task with no configured response time is misconfigured, and is
 * refused rather than given a generic limit.
 */
export function speakingDurationPolicy(
  question: Pick<DiagnosticQuestionForScoring, 'id' | 'responseSeconds'>,
): SpeakingDurationPolicy {
  const seconds = question.responseSeconds;
  if (!Number.isInteger(seconds) || (seconds as number) <= 0) {
    throw new Error(
      `SPEAKING_TASK_MISCONFIGURED: question ${question.id} has no response time`,
    );
  }
  const configuredResponseMs = (seconds as number) * 1000;
  return {
    configuredResponseMs,
    minMs: SPEAKING_MIN_DURATION_MS,
    maxMs:
      configuredResponseMs +
      SPEAKING_CODEC_TOLERANCE_MS +
      SPEAKING_CAPTURE_STOP_ALLOWANCE_MS,
  };
}

export type RecordingDurationVerdict =
  | { ok: true; durationMs: number }
  | {
      ok: false;
      code: 'TOO_SHORT' | 'TOO_LONG' | 'CLIENT_DURATION_MISMATCH';
      durationMs: number;
    };

/**
 * Judge a recording by its DECODED duration. The client's figure is only
 * cross-checked; it can neither extend the limit nor replace the measurement.
 */
export function checkRecordingDuration(
  policy: SpeakingDurationPolicy,
  measuredMs: number,
  clientReportedMs?: number,
): RecordingDurationVerdict {
  if (measuredMs < policy.minMs)
    return { ok: false, code: 'TOO_SHORT', durationMs: measuredMs };
  if (measuredMs > policy.maxMs)
    return { ok: false, code: 'TOO_LONG', durationMs: measuredMs };
  if (
    clientReportedMs !== undefined &&
    (!Number.isFinite(clientReportedMs) ||
      Math.abs(clientReportedMs - measuredMs) >
        SPEAKING_CLIENT_MISMATCH_TOLERANCE_MS)
  )
    return {
      ok: false,
      code: 'CLIENT_DURATION_MISMATCH',
      durationMs: measuredMs,
    };
  return { ok: true, durationMs: measuredMs };
}

// ------------------------------------------------------------ writing length

/**
 * The application's word-count convention, identical to the learner page's
 * `countWritingWords`, so server and client always agree on the number shown.
 */
export function countDiagnosticWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

export type WritingLengthAssessment = {
  wordCount: number;
  wordMin: number | null;
  wordMax: number | null;
  belowMinimum: boolean;
  belowTwoThirdsMinimum: boolean;
  aboveMaximum: boolean;
};

/**
 * The approved rubric (WRT_RUBRIC_V3 wordCountHandling) makes the stated word
 * range GUIDANCE for grading, not a submission gate: length below the minimum
 * is reflected in task_achievement, and only below two thirds of it. So these
 * flags travel to the grader; they never reject the learner's text.
 */
export function assessWritingLength(
  text: string,
  wordMin: number | null | undefined,
  wordMax: number | null | undefined,
): WritingLengthAssessment {
  const wordCount = countDiagnosticWords(text);
  const min = Number.isInteger(wordMin) ? (wordMin as number) : null;
  const max = Number.isInteger(wordMax) ? (wordMax as number) : null;
  return {
    wordCount,
    wordMin: min,
    wordMax: max,
    belowMinimum: min !== null && wordCount < min,
    belowTwoThirdsMinimum: min !== null && wordCount < (2 * min) / 3,
    aboveMaximum: max !== null && wordCount > max,
  };
}

/** Hard limits on the text itself, independent of the guidance range. */
export const WRITING_MIN_CHARACTERS = 2;
export const WRITING_MAX_CHARACTERS = 2000;

// ------------------------------------------------------------------ rubric

export type RubricCriterion = {
  key: string;
  min: number;
  max: number;
  description: string;
  anchors: Array<{ score: number; anchor: string }>;
};

export type RubricDefinition = {
  id: number;
  skill: 'SPEAKING' | 'WRITING';
  version: string;
  criteria: RubricCriterion[];
};

/** Parse a persisted rubric row, refusing one that cannot support grading. */
export function parseRubric(row: {
  id: number;
  skill: string;
  rubricVersion: string;
  criteria: unknown;
}): RubricDefinition {
  if (row.skill !== 'SPEAKING' && row.skill !== 'WRITING')
    throw new Error(`RUBRIC_INVALID: rubric ${row.id} skill ${row.skill}`);
  if (!Array.isArray(row.criteria) || row.criteria.length === 0)
    throw new Error(`RUBRIC_INVALID: rubric ${row.id} has no criteria`);
  const criteria = row.criteria.map((raw: any, index: number) => {
    const key = typeof raw?.criterionKey === 'string' ? raw.criterionKey : '';
    const min = Number(raw?.scoreMin);
    const max = Number(raw?.scoreMax);
    if (!key || !Number.isInteger(min) || !Number.isInteger(max) || min >= max)
      throw new Error(`RUBRIC_INVALID: rubric ${row.id} criterion ${index}`);
    return {
      key,
      min,
      max,
      description: String(raw?.description ?? ''),
      anchors: Array.isArray(raw?.anchors)
        ? raw.anchors.map((a: any) => ({
            score: Number(a?.score),
            anchor: String(a?.anchor ?? ''),
          }))
        : [],
    };
  });
  if (new Set(criteria.map((c) => c.key)).size !== criteria.length)
    throw new Error(`RUBRIC_INVALID: rubric ${row.id} repeats a criterion`);
  return { id: row.id, skill: row.skill, version: row.rubricVersion, criteria };
}

// ---------------------------------------------------- grader output contract

export type RubricGradeRequest = {
  skill: 'SPEAKING' | 'WRITING';
  /** Echoed back by the grader; a mismatch means it graded something else. */
  submissionRef: string;
  rubric: RubricDefinition;
  taskPrompt: string;
  taskInstructions: string | null;
  responseText?: string;
  writingLength?: WritingLengthAssessment;
  /** Normalized 16 kHz mono WAV, for a speech grader. */
  audio?: Buffer;
  durationMs?: number;
};

/** Overall feedback shorter than this is not feedback a learner can use. */
export const FEEDBACK_MIN_CHARACTERS = 20;
/** Per-criterion feedback shorter than this says nothing about the score. */
export const CRITERION_FEEDBACK_MIN_CHARACTERS = 8;
export const EVIDENCE_QUOTES_MIN = 1;
export const EVIDENCE_QUOTES_MAX = 5;

/** What a grader must return. Anything else is rejected, never coerced. */
export type ValidatedRubricGrade = {
  criteria: Record<string, number>;
  criterionFeedback: Record<string, string>;
  feedback: string;
  suggestions: string[];
  /** Spans of the graded text (or transcript) the scores rest on. */
  evidenceQuotes: string[];
  transcript: string | null;
  /** Speech evidence attached by the speech adapter, never by the model. */
  speechEvidence: Record<string, unknown> | null;
  /** Mean criterion score as a percentage of each criterion's range. */
  taskPercentage: number;
};

export type RubricGradeVerdict =
  { ok: true; grade: ValidatedRubricGrade } | { ok: false; reason: string };

/** Case, punctuation and spacing are ignored when grounding a quote. */
export function normalizeForGrounding(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

/**
 * Validate raw grader output against the rubric, as the approved
 * aiGradingRequirements state, plus the evidence C3 requires before a score
 * may be called final:
 * - the submission and rubric version it claims to grade are these ones;
 * - every criterion present, an integer inside its range, no others;
 * - feedback for every criterion and a usable overall feedback;
 * - at least one evidence quote, and every quote found in what was graded
 *   (the learner's text, or the speech transcript attached by the adapter);
 * - for Speaking, a transcript and speech evidence from the speech adapter.
 * Raw output is never written as a score unvalidated.
 */
/**
 * Vietnamese learner feedback must carry its diacritics. A reply such as
 * "Chao ban, bai viet cua ban rat tot" is unreadable for a Vietnamese learner;
 * any sentence of real Vietnamese has at least one marked letter. A model
 * that drops them drops them from the whole reply, so the overall feedback
 * is the one checked.
 */
const VIETNAMESE_MARKED =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu;
export function hasVietnameseDiacritics(text: string): boolean {
  return VIETNAMESE_MARKED.test(text);
}

export function validateRubricGrade(
  request: Pick<
    RubricGradeRequest,
    'rubric' | 'submissionRef' | 'skill' | 'responseText'
  >,
  raw: unknown,
): RubricGradeVerdict {
  let value: any = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'MALFORMED_JSON' };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, reason: 'NOT_AN_OBJECT' };
  if (value.submissionRef !== request.submissionRef)
    return { ok: false, reason: 'DIFFERENT_SUBMISSION' };
  if (value.rubricVersion !== request.rubric.version)
    return { ok: false, reason: 'DIFFERENT_RUBRIC_VERSION' };
  const scores = value.criteria;
  if (!scores || typeof scores !== 'object' || Array.isArray(scores))
    return { ok: false, reason: 'CRITERIA_MISSING' };

  const criteria: Record<string, number> = {};
  for (const criterion of request.rubric.criteria) {
    const score = scores[criterion.key];
    if (score === undefined || score === null)
      return { ok: false, reason: `CRITERION_ABSENT:${criterion.key}` };
    if (typeof score !== 'number' || !Number.isFinite(score))
      return { ok: false, reason: `CRITERION_NOT_NUMERIC:${criterion.key}` };
    if (
      !Number.isInteger(score) ||
      score < criterion.min ||
      score > criterion.max
    )
      return { ok: false, reason: `CRITERION_OUT_OF_RANGE:${criterion.key}` };
    criteria[criterion.key] = score;
  }
  const unknown = Object.keys(scores).filter(
    (key) => !request.rubric.criteria.some((c) => c.key === key),
  );
  if (unknown.length)
    return { ok: false, reason: `UNKNOWN_CRITERION:${unknown[0]}` };

  const notes = value.criterionFeedback;
  if (!notes || typeof notes !== 'object' || Array.isArray(notes))
    return { ok: false, reason: 'CRITERION_FEEDBACK_MISSING' };
  const criterionFeedback: Record<string, string> = {};
  for (const criterion of request.rubric.criteria) {
    const note =
      typeof notes[criterion.key] === 'string'
        ? notes[criterion.key].trim()
        : '';
    if (note.length < CRITERION_FEEDBACK_MIN_CHARACTERS)
      return {
        ok: false,
        reason: `CRITERION_FEEDBACK_MISSING:${criterion.key}`,
      };
    criterionFeedback[criterion.key] = note;
  }
  const unknownNotes = Object.keys(notes).filter(
    (key) => !request.rubric.criteria.some((c) => c.key === key),
  );
  if (unknownNotes.length)
    return { ok: false, reason: `UNKNOWN_CRITERION:${unknownNotes[0]}` };

  const feedback =
    typeof value.feedback === 'string' ? value.feedback.trim() : '';
  if (!feedback) return { ok: false, reason: 'FEEDBACK_MISSING' };
  if (feedback.length < FEEDBACK_MIN_CHARACTERS)
    return { ok: false, reason: 'FEEDBACK_TOO_SHORT' };
  if (!hasVietnameseDiacritics(feedback))
    return { ok: false, reason: 'FEEDBACK_WITHOUT_DIACRITICS' };

  const transcript =
    typeof value.transcript === 'string' && value.transcript.trim()
      ? value.transcript.trim()
      : null;
  const speechEvidence =
    value.speechEvidence &&
    typeof value.speechEvidence === 'object' &&
    !Array.isArray(value.speechEvidence)
      ? (value.speechEvidence as Record<string, unknown>)
      : null;
  if (request.skill === 'SPEAKING' && (!transcript || !speechEvidence))
    return { ok: false, reason: 'SPEECH_EVIDENCE_MISSING' };

  const gradedText =
    request.skill === 'SPEAKING' ? transcript : (request.responseText ?? null);
  if (!gradedText || !normalizeForGrounding(gradedText))
    return { ok: false, reason: 'GRADED_TEXT_MISSING' };
  if (!Array.isArray(value.evidenceQuotes))
    return { ok: false, reason: 'EVIDENCE_QUOTES_MISSING' };
  const evidenceQuotes = value.evidenceQuotes
    .filter((q: unknown) => typeof q === 'string' && q.trim())
    .map((q: string) => q.trim());
  if (
    evidenceQuotes.length < EVIDENCE_QUOTES_MIN ||
    evidenceQuotes.length !== value.evidenceQuotes.length
  )
    return { ok: false, reason: 'EVIDENCE_QUOTES_MISSING' };
  if (evidenceQuotes.length > EVIDENCE_QUOTES_MAX)
    return { ok: false, reason: 'EVIDENCE_QUOTES_TOO_MANY' };
  const haystack = ` ${normalizeForGrounding(gradedText)} `;
  for (const quote of evidenceQuotes) {
    const needle = normalizeForGrounding(quote);
    if (!needle || !haystack.includes(` ${needle} `))
      return { ok: false, reason: 'EVIDENCE_QUOTE_NOT_IN_RESPONSE' };
  }

  const taskPercentage =
    (request.rubric.criteria.reduce(
      (sum, c) => sum + (criteria[c.key] - c.min) / (c.max - c.min),
      0,
    ) /
      request.rubric.criteria.length) *
    100;

  return {
    ok: true,
    grade: {
      criteria,
      criterionFeedback,
      feedback,
      suggestions: Array.isArray(value.suggestions)
        ? value.suggestions
            .filter((s: unknown) => typeof s === 'string' && s.trim())
            .map((s: string) => s.trim())
            .slice(0, 3)
        : [],
      evidenceQuotes,
      transcript,
      speechEvidence,
      taskPercentage,
    },
  };
}

// ---------------------------------------------------------- grader provider

export const DIAGNOSTIC_RUBRIC_GRADER = Symbol('DIAGNOSTIC_RUBRIC_GRADER');

/**
 * `real` graders call external providers; `mock` graders are deterministic
 * stand-ins whose scores mean nothing; `unavailable` refuses every request.
 * Only `real` may grade learners of an active assessment.
 */
export type DiagnosticGraderMode = 'real' | 'mock' | 'unavailable';

/**
 * The only seam to external grading. Returns RAW output; validation is never
 * the grader's job, so a misbehaving grader cannot produce a score.
 */
export interface DiagnosticRubricGrader {
  readonly provider: string;
  readonly providerVersion: string;
  readonly mode: DiagnosticGraderMode;
  /** The services actually used for one skill, when narrower than `provider`. */
  providerFor?(skill: 'SPEAKING' | 'WRITING'): string;
  grade(request: RubricGradeRequest): Promise<unknown>;
}

/**
 * How a provider failure is handled:
 * - NOT_CONFIGURED: no usable provider; fail now, retrying cannot help.
 * - PERMANENT: credentials or request shape rejected; fail now.
 * - TRANSIENT: throttling, timeout, connectivity, service fault; retry once.
 * - INSUFFICIENT_EVIDENCE: the submission cannot support a grade (for
 *   example no recognizable speech); fail now rather than invent a score.
 */
export type DiagnosticGraderFailureKind =
  'NOT_CONFIGURED' | 'PERMANENT' | 'TRANSIENT' | 'INSUFFICIENT_EVIDENCE';

export class DiagnosticGraderError extends Error {
  constructor(
    readonly kind: DiagnosticGraderFailureKind,
    readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DiagnosticGraderError';
  }
}

/** Thrown when no grader able to apply the rubric is configured. */
export class DiagnosticGraderUnavailableError extends DiagnosticGraderError {
  constructor(message: string) {
    super('NOT_CONFIGURED', message.split(':')[0]);
    this.message = message;
    this.name = 'DiagnosticGraderUnavailableError';
  }
}

/** How many times one job asks the grader before failing the task. */
export const RUBRIC_GRADE_ATTEMPTS = 2;

export type RubricGradeOutcome =
  | {
      status: 'GRADED';
      grade: ValidatedRubricGrade;
      attempts: number;
      raw: unknown;
    }
  | {
      status: 'GRADING_FAILED';
      reason: string;
      attempts: number;
      raw: unknown;
    };

const FAILURE_PREFIX: Record<DiagnosticGraderFailureKind, string> = {
  NOT_CONFIGURED: '',
  PERMANENT: 'PROVIDER_PERMANENT:',
  TRANSIENT: 'PROVIDER_TRANSIENT:',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE:',
};

/**
 * Ask the grader, validate, and retry once on rejected output or a transient
 * provider failure, as the rubric requires. Unconfigured, permanent and
 * no-evidence failures are not retried. Never returns a score that failed
 * validation.
 */
export async function gradeWithRubric(
  grader: DiagnosticRubricGrader,
  request: RubricGradeRequest,
): Promise<RubricGradeOutcome> {
  let lastReason = 'GRADER_FAILED';
  let lastRaw: unknown = null;
  for (let attempt = 1; attempt <= RUBRIC_GRADE_ATTEMPTS; attempt += 1) {
    try {
      lastRaw = await grader.grade(request);
    } catch (error) {
      if (error instanceof DiagnosticGraderError) {
        const reason = `${FAILURE_PREFIX[error.kind]}${error.message}`;
        if (error.kind !== 'TRANSIENT')
          return {
            status: 'GRADING_FAILED',
            reason,
            attempts: attempt,
            raw: null,
          };
        lastReason = reason;
        lastRaw = null;
        continue;
      }
      lastReason = `GRADER_ERROR:${error instanceof Error ? error.message : String(error)}`;
      lastRaw = null;
      continue;
    }
    const verdict = validateRubricGrade(request, lastRaw);
    if (verdict.ok)
      return {
        status: 'GRADED',
        grade: verdict.grade,
        attempts: attempt,
        raw: lastRaw,
      };
    lastReason = `INVALID_GRADER_OUTPUT:${verdict.reason}`;
  }
  return {
    status: 'GRADING_FAILED',
    reason: lastReason,
    attempts: RUBRIC_GRADE_ATTEMPTS,
    raw: lastRaw,
  };
}

// --------------------------------------------------------- skill completion

export type ProductiveTaskRow = {
  questionId: number;
  status: string;
  score: number | null | undefined;
};

export type ProductiveSkillSummary = {
  status: 'COMPLETE' | 'PENDING' | 'FAILED' | 'INCOMPLETE' | 'NOT_APPLICABLE';
  /** Mean task percentage, rounded once here; null unless COMPLETE. */
  score: number | null;
  expectedCount: number;
  gradedCount: number;
  pendingQuestionIds: number[];
  failedQuestionIds: number[];
  missingQuestionIds: number[];
};

const PENDING_STATUSES = new Set(['SUBMITTED', 'QUEUED', 'GRADING']);

/**
 * A productive skill has a score only when EVERY one of its tasks is GRADED
 * (rubric normalisationIntent.missingTask). A pending, failed or missing task
 * is never counted as zero and never averaged away. No band or placement
 * threshold is applied here.
 */
export function summarizeProductiveSkill(
  expectedQuestionIds: number[],
  rows: ProductiveTaskRow[],
): ProductiveSkillSummary {
  const byQuestion = new Map(rows.map((row) => [row.questionId, row]));
  const graded: number[] = [];
  const pendingQuestionIds: number[] = [];
  const failedQuestionIds: number[] = [];
  const missingQuestionIds: number[] = [];
  for (const id of expectedQuestionIds) {
    const row = byQuestion.get(id);
    if (!row) missingQuestionIds.push(id);
    else if (
      row.status === 'GRADED' &&
      typeof row.score === 'number' &&
      Number.isFinite(row.score)
    )
      graded.push(row.score);
    else if (PENDING_STATUSES.has(row.status)) pendingQuestionIds.push(id);
    else if (row.status === 'GRADING_FAILED') failedQuestionIds.push(id);
    // NOT_STARTED, NOT_SUBMITTED, SKIPPED or an unknown status: no answer
    // that could be graded exists, which is neither pending nor failed.
    else missingQuestionIds.push(id);
  }
  const expectedCount = expectedQuestionIds.length;
  const status: ProductiveSkillSummary['status'] =
    expectedCount === 0
      ? 'NOT_APPLICABLE'
      : graded.length === expectedCount
        ? 'COMPLETE'
        : pendingQuestionIds.length
          ? 'PENDING'
          : failedQuestionIds.length
            ? 'FAILED'
            : 'INCOMPLETE';
  return {
    status,
    score:
      status === 'COMPLETE'
        ? Math.round(
            (graded.reduce((sum, value) => sum + value, 0) / graded.length) *
              10,
          ) / 10
        : null,
    expectedCount,
    gradedCount: graded.length,
    pendingQuestionIds,
    failedQuestionIds,
    missingQuestionIds,
  };
}
