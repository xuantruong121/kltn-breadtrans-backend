import { createHash } from 'crypto';
import type {
  ConfirmationMethod,
  ExplanationCause,
  GroupReview,
  GroupReviewStatus,
  QuestionReview,
  QuestionVerdict,
  ReviewConfirmation,
  ReviewKind,
  ReviewStep,
  ReviewStepName,
} from './toeic-answer-review.types';

/**
 * Pure rules of the TOEIC answer review: no Prisma, no provider call. The
 * service supplies AI replies and content; these functions decide.
 */

type ReviewQuestion = {
  text?: string | null;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: string | null;
};

export type ReviewGroup = {
  transcript?: string | null;
  passageText?: string | null;
  imageBrief?: string | null;
  questions?: ReviewQuestion[];
};

/** Parts whose answers must be backed by a quote from the stimulus. */
const EVIDENCE_PARTS = new Set([2, 3, 4, 6, 7]);

export const optionCountOf = (part: number) => (part === 2 ? 3 : 4);

export const reviewItemId = (questionNumber: number) => `q${questionNumber}`;

/** What a test taker reads or hears before answering; none for Part 5. */
export function groupStimulus(part: number, group: ReviewGroup) {
  const pieces =
    part >= 2 && part <= 4
      ? [group.transcript, group.passageText]
      : part === 6 || part === 7
        ? [group.passageText]
        : [];
  const text = pieces
    .map((piece) => String(piece ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

const optionsOf = (question: ReviewQuestion) =>
  Array.isArray(question.options)
    ? question.options.map((option) => String(option ?? ''))
    : [];

/**
 * The independent solver's payload: stimulus, question and options only. It
 * never carries the generator's key or explanation.
 */
export function solveRequestOf(
  part: number,
  groups: Array<{ group: ReviewGroup; firstQuestionNumber: number }>,
) {
  return {
    part,
    groups: groups.map(({ group, firstQuestionNumber }) => {
      const stimulus = groupStimulus(part, group);
      return {
        ...(stimulus ? { stimulus } : {}),
        questions: (group.questions ?? []).map((question, index) => ({
          id: reviewItemId(firstQuestionNumber + index),
          question: String(question.text ?? '').trim(),
          options: optionsOf(question),
        })),
      };
    }),
  };
}

/**
 * The explanation check's payload: stimulus (except Part 5), question,
 * options and the generator's explanation, but never the marked key.
 */
export function explanationRequestOf(
  part: number,
  groups: Array<{ group: ReviewGroup; firstQuestionNumber: number }>,
) {
  return {
    part,
    groups: groups.map(({ group, firstQuestionNumber }) => {
      const stimulus = groupStimulus(part, group);
      return {
        ...(stimulus ? { stimulus } : {}),
        questions: (group.questions ?? []).map((question, index) => ({
          id: reviewItemId(firstQuestionNumber + index),
          question: String(question.text ?? '').trim(),
          options: optionsOf(question),
          explanation: String(question.explanation ?? '').trim(),
        })),
      };
    }),
  };
}

export type SolveAnswer = {
  id: string;
  choice: number;
  alsoCorrect: number[];
  answerable: boolean;
  evidence: string[];
  reasoning: string;
  evidenceSupportsAnswer: boolean;
};

export type ExplanationAnswer = {
  id: string;
  claimedChoice: number;
  supportsClaim: boolean;
  reasoning: string;
  containsContradiction: boolean;
};

export type ValidationResult<T> =
  { ok: true; answers: Map<string, T> } | { ok: false; reason: string };

type ExpectedItem = { id: string; optionCount: number; part: number };

function answerList(output: unknown, key: string): unknown[] | null {
  const list = (output as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? list : null;
}

function checkIds<T extends { id: string }>(
  expected: ExpectedItem[],
  rows: T[],
): string | null {
  const wanted = new Set(expected.map((item) => item.id));
  const seen = new Set<string>();
  for (const row of rows) {
    if (!wanted.has(row.id)) return `unknown id ${row.id}`;
    if (seen.has(row.id)) return `duplicate id ${row.id}`;
    seen.add(row.id);
  }
  const missing = expected.find((item) => !seen.has(item.id));
  return missing ? `missing id ${missing.id}` : null;
}

const isIndex = (value: unknown, optionCount: number, allowNone: boolean) =>
  Number.isInteger(value) &&
  (value as number) >= (allowNone ? -1 : 0) &&
  (value as number) < optionCount;

/** Fails closed: any malformed row makes the whole reply invalid. */
export function validateSolveOutput(
  expected: ExpectedItem[],
  output: unknown,
): ValidationResult<SolveAnswer> {
  const rows = answerList(output, 'answers');
  if (!rows) return { ok: false, reason: 'reply has no answers array' };
  const byId = new Map(expected.map((item) => [item.id, item]));
  const answers = new Map<string, SolveAnswer>();
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const id = typeof row?.id === 'string' ? row.id : '';
    const item = byId.get(id);
    if (!item) return { ok: false, reason: `unknown id ${id || '(none)'}` };
    if (answers.has(id)) return { ok: false, reason: `duplicate id ${id}` };
    if (!isIndex(row.choice, item.optionCount, true))
      return { ok: false, reason: `${id}: choice out of range` };
    if (
      !Array.isArray(row.alsoCorrect) ||
      row.alsoCorrect.some(
        (value) => !isIndex(value, item.optionCount, false),
      ) ||
      new Set(row.alsoCorrect).size !== row.alsoCorrect.length ||
      row.alsoCorrect.includes(row.choice)
    )
      return { ok: false, reason: `${id}: alsoCorrect invalid` };
    if (typeof row.answerable !== 'boolean')
      return { ok: false, reason: `${id}: answerable not boolean` };
    if (
      !Array.isArray(row.evidence) ||
      row.evidence.some((value) => typeof value !== 'string')
    )
      return { ok: false, reason: `${id}: evidence not a string list` };
    if (typeof row.reasoning !== 'string' || !row.reasoning.trim())
      return { ok: false, reason: `${id}: reasoning empty` };
    if (typeof row.evidenceSupportsAnswer !== 'boolean')
      return { ok: false, reason: `${id}: evidenceSupportsAnswer not boolean` };
    const evidence = (row.evidence as string[])
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      EVIDENCE_PARTS.has(item.part) &&
      row.answerable === true &&
      evidence.length < 1
    )
      return { ok: false, reason: `${id}: no evidence quoted` };
    answers.set(id, {
      id,
      choice: row.choice as number,
      alsoCorrect: row.alsoCorrect as number[],
      answerable: row.answerable,
      evidence,
      reasoning: row.reasoning.trim(),
      evidenceSupportsAnswer: row.evidenceSupportsAnswer,
    });
  }
  const idIssue = checkIds(expected, [...answers.values()]);
  return idIssue ? { ok: false, reason: idIssue } : { ok: true, answers };
}

export function validateExplanationOutput(
  expected: ExpectedItem[],
  output: unknown,
): ValidationResult<ExplanationAnswer> {
  const rows = answerList(output, 'checks');
  if (!rows) return { ok: false, reason: 'reply has no checks array' };
  const byId = new Map(expected.map((item) => [item.id, item]));
  const answers = new Map<string, ExplanationAnswer>();
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const id = typeof row?.id === 'string' ? row.id : '';
    const item = byId.get(id);
    if (!item) return { ok: false, reason: `unknown id ${id || '(none)'}` };
    if (answers.has(id)) return { ok: false, reason: `duplicate id ${id}` };
    if (!isIndex(row.claimedChoice, item.optionCount, true))
      return { ok: false, reason: `${id}: claimedChoice out of range` };
    if (typeof row.supportsClaim !== 'boolean')
      return { ok: false, reason: `${id}: supportsClaim not boolean` };
    if (typeof row.containsContradiction !== 'boolean')
      return { ok: false, reason: `${id}: containsContradiction not boolean` };
    if (typeof row.reasoning !== 'string' || !row.reasoning.trim())
      return { ok: false, reason: `${id}: reasoning empty` };
    answers.set(id, {
      id,
      claimedChoice: row.claimedChoice as number,
      supportsClaim: row.supportsClaim,
      containsContradiction: row.containsContradiction,
      reasoning: row.reasoning.trim(),
    });
  }
  const idIssue = checkIds(expected, [...answers.values()]);
  return idIssue ? { ok: false, reason: idIssue } : { ok: true, answers };
}

/** Lower case, straight quotes, single spaces: only for quote matching. */
export function normalizeForMatch(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when every fragment of the quote occurs in the source. This proves the
 * quote exists, never that it proves the answer.
 */
export function quoteFound(quote: string, source: string) {
  const haystack = normalizeForMatch(source);
  const fragments = normalizeForMatch(quote)
    .split(/\.{3}|…/)
    .map((fragment) =>
      fragment.replace(/^["'\s.,;:!?-]+|["'\s.,;:!?-]+$/g, '').trim(),
    )
    .filter((fragment) => fragment.length >= 3);
  return fragments.length > 0 && fragments.every((f) => haystack.includes(f));
}

export function judgeSolve(input: {
  part: number;
  stimulus?: string;
  questionText?: string | null;
  key: number;
  answer: SolveAnswer;
}): { verdict: QuestionVerdict; detail: string } {
  const { answer, key } = input;
  if (!answer.answerable)
    return {
      verdict: 'UNANSWERABLE',
      detail: 'Người giải độc lập cho rằng không đủ dữ kiện để trả lời.',
    };
  if (answer.choice === -1)
    return {
      verdict: 'REVIEW_INVALID',
      detail: 'Người giải độc lập không chọn phương án nào.',
    };
  if (answer.alsoCorrect.length)
    return {
      verdict: 'AMBIGUOUS',
      detail: `Có hơn một phương án đúng: ${[
        answer.choice,
        ...answer.alsoCorrect,
      ]
        .map((index) => String.fromCharCode(65 + index))
        .join(', ')}.`,
    };
  if (answer.choice !== key)
    return {
      verdict: 'DISAGREE',
      detail: `Người giải độc lập chọn ${String.fromCharCode(65 + answer.choice)}, đáp án đánh dấu là ${String.fromCharCode(65 + key)}.`,
    };
  if (EVIDENCE_PARTS.has(input.part)) {
    const source = [input.stimulus, input.questionText]
      .filter(Boolean)
      .join('\n');
    const missing = answer.evidence.filter(
      (quote) => !quoteFound(quote, source),
    );
    if (missing.length)
      return {
        verdict: 'EVIDENCE_NOT_FOUND',
        detail: `Trích dẫn không có trong ngữ liệu: "${missing[0].slice(0, 160)}".`,
      };
  }
  if (!answer.evidenceSupportsAnswer)
    return {
      verdict: 'EVIDENCE_INSUFFICIENT',
      detail: 'Trích dẫn có trong ngữ liệu nhưng chưa đủ để chứng minh đáp án.',
    };
  return { verdict: 'AGREE', detail: 'Khớp đáp án đánh dấu.' };
}

export function judgeExplanation(
  key: number,
  answer: ExplanationAnswer,
): { verdict: QuestionVerdict; detail: string; causes: ExplanationCause[] } {
  const causes: ExplanationCause[] = [];
  if (answer.claimedChoice !== key) causes.push('WRONG_CHOICE');
  if (!answer.supportsClaim) causes.push('DOES_NOT_SUPPORT');
  if (answer.containsContradiction) causes.push('CONTRADICTION');
  if (!causes.length)
    return {
      verdict: 'AGREE',
      detail: 'Giải thích bảo vệ đúng đáp án.',
      causes,
    };
  const words: Record<ExplanationCause, string> = {
    WRONG_CHOICE:
      answer.claimedChoice === -1
        ? 'giải thích không bảo vệ phương án nào'
        : `giải thích bảo vệ phương án ${String.fromCharCode(65 + answer.claimedChoice)}`,
    DOES_NOT_SUPPORT: 'lập luận không khớp ngữ liệu',
    CONTRADICTION: 'giải thích tự mâu thuẫn',
  };
  return {
    verdict: 'EXPLANATION_MISMATCH',
    detail: `Giải thích không khớp: ${causes.map((cause) => words[cause]).join('; ')}.`,
    causes,
  };
}

/** The first verdict that is not AGREE wins. */
export function combinedVerdict(review: QuestionReview): QuestionVerdict {
  for (const part of [review.solve, review.explanation, review.vision])
    if (part && part.verdict !== 'AGREE') return part.verdict;
  return 'AGREE';
}

export function groupStatusOf(
  part: number,
  steps: GroupReview['steps'],
  verdicts: QuestionReview[],
): GroupReviewStatus {
  const rejected = verdicts.some((row) => row.verdict !== 'AGREE');
  if (part === 1) {
    const vision = steps.part1VisionReview;
    if (!vision || vision.status !== 'OK') return 'UNREVIEWED';
    return rejected ? 'REJECTED' : 'NEEDS_ADMIN_CONFIRM';
  }
  const solve = steps.independentSolve;
  if (!solve || solve.status === 'UNAVAILABLE') return 'UNREVIEWED';
  if (rejected || solve.status === 'INVALID') return 'REJECTED';
  const explanation = steps.explanationCheck;
  if (!explanation || explanation.status === 'UNAVAILABLE') return 'UNREVIEWED';
  if (explanation.status === 'INVALID') return 'REJECTED';
  return solve.reviewKind === 'INDEPENDENT'
    ? 'REVIEWED_INDEPENDENT'
    : 'REVIEWED_DEGRADED';
}

/** Part 2-7: which review step still has to run, or null when settled. */
export function pendingStep(
  review: Pick<GroupReview, 'steps' | 'verdicts'> | undefined,
): 'independentSolve' | 'explanationCheck' | null {
  const solve = review?.steps.independentSolve;
  if (!solve || solve.status === 'UNAVAILABLE') return 'independentSolve';
  if (solve.status === 'INVALID') return null;
  if (review.verdicts.some((row) => row.verdict !== 'AGREE')) return null;
  const explanation = review.steps.explanationCheck;
  if (!explanation || explanation.status === 'UNAVAILABLE')
    return 'explanationCheck';
  return null;
}

/** The note that tells the generator why its batch was refused. */
export function reviewRejection(verdicts: QuestionReview[]) {
  const refused = verdicts.filter((row) => row.verdict !== 'AGREE');
  if (!refused.length) return '';
  return `Kiểm định đáp án bác bỏ: ${refused
    .slice(0, 6)
    .map((row) => {
      const detail =
        [row.solve, row.explanation, row.vision].find(
          (part) => part && part.verdict !== 'AGREE',
        )?.detail ?? row.verdict;
      return `câu ${row.questionNumber} (${row.verdict}): ${detail}`;
    })
    .join(
      ' | ',
    )}. Viết lại để mỗi câu chỉ có đúng một đáp án được ngữ liệu chứng minh và giải thích bảo vệ đúng đáp án đó.`;
}

// ---- provenance ------------------------------------------------------------

/** The company that made a model, read from its id; null when unknown. */
export function vendorOfModel(
  provider: string,
  model: string,
  declaredVendor?: string | null,
): string | null {
  const name = provider.toLowerCase();
  if (name === 'gemini') return 'google';
  if (name === 'cloudflare') {
    const match = /^@cf\/([^/]+)\//.exec(model.trim());
    return match ? match[1].toLowerCase() : null;
  }
  const vendor = declaredVendor?.trim().toLowerCase();
  return vendor || null;
}

/** Same or unknown vendor as the generator is never independent. */
export function reviewKindFor(
  reviewerVendor: string | null,
  generatorVendor: string | null,
): ReviewKind {
  return reviewerVendor && generatorVendor && reviewerVendor !== generatorVendor
    ? 'INDEPENDENT'
    : 'SAME_PROVIDER';
}

// ---- content hash ----------------------------------------------------------

export type HashImage = {
  assetId?: string | null;
  url?: string | null;
  sha256?: string | null;
};

function canonical(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as any)[key])]),
    );
  return value;
}

/**
 * sha256 of the group in a fixed field order: stimulus, image brief, the image
 * itself (its bytes' sha256 above all), and each question with its key and
 * explanation.
 */
export function canonicalGroupHash(
  part: number,
  group: ReviewGroup,
  image?: HashImage | null,
) {
  const payload = canonical({
    part,
    transcript: group.transcript,
    passageText: group.passageText,
    imageBrief: group.imageBrief,
    image: image
      ? {
          assetId: image.assetId ?? null,
          url: image.url ?? null,
          sha256: image.sha256 ?? null,
        }
      : null,
    questions: (group.questions ?? []).map((question) => ({
      text: question.text,
      options: optionsOf(question),
      correctIndex: question.correctIndex,
      explanation: question.explanation,
    })),
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Hash of a Part 1 Draft group: its question, brief and photo bytes. */
export function part1DraftHash(
  group: {
    transcriptText?: string | null;
    passageText?: string | null;
    imageBrief?: string | null;
    questions?: ReviewQuestion[];
  },
  image: { r2Key?: string | null; url?: string | null; sha256?: string | null },
) {
  return canonicalGroupHash(
    1,
    {
      transcript: group.transcriptText,
      passageText: group.passageText,
      imageBrief: group.imageBrief,
      questions: group.questions,
    },
    {
      assetId: image.r2Key ?? null,
      url: image.url ?? null,
      sha256: image.sha256 ?? null,
    },
  );
}

export type VisionAnswer = {
  choice: number;
  alsoCorrect: number[];
  answerable: boolean;
  reasoning: string;
};

export function validatePart1VisionOutput(
  output: unknown,
  optionCount = 4,
):
  | { ok: true; answers: Map<string, VisionAnswer> }
  | { ok: false; reason: string } {
  const row = output as Record<string, unknown> | null;
  if (!row || typeof row !== 'object')
    return { ok: false, reason: 'reply is not an object' };
  if (!isIndex(row.choice, optionCount, true))
    return { ok: false, reason: 'choice out of range' };
  if (
    !Array.isArray(row.alsoCorrect) ||
    row.alsoCorrect.some((value) => !isIndex(value, optionCount, false)) ||
    new Set(row.alsoCorrect).size !== row.alsoCorrect.length ||
    row.alsoCorrect.includes(row.choice)
  )
    return { ok: false, reason: 'alsoCorrect invalid' };
  if (typeof row.answerable !== 'boolean')
    return { ok: false, reason: 'answerable not boolean' };
  if (typeof row.reasoning !== 'string' || !row.reasoning.trim())
    return { ok: false, reason: 'reasoning empty' };
  return {
    ok: true,
    answers: new Map([
      [
        'q',
        {
          choice: row.choice as number,
          alsoCorrect: row.alsoCorrect as number[],
          answerable: row.answerable,
          reasoning: row.reasoning.trim(),
        },
      ],
    ]),
  };
}

export function judgePart1Vision(
  key: number,
  answer: VisionAnswer,
): { verdict: QuestionVerdict; detail: string } {
  if (!answer.answerable)
    return {
      verdict: 'UNANSWERABLE',
      detail: 'Ảnh không đủ để chọn câu mô tả.',
    };
  if (answer.choice === -1)
    return {
      verdict: 'REVIEW_INVALID',
      detail: 'Vision không chọn câu mô tả nào.',
    };
  if (answer.alsoCorrect.length)
    return {
      verdict: 'AMBIGUOUS',
      detail: `Có hơn một câu đúng với ảnh: ${[
        answer.choice,
        ...answer.alsoCorrect,
      ]
        .map((index) => String.fromCharCode(65 + index))
        .join(', ')}.`,
    };
  if (answer.choice !== key)
    return {
      verdict: 'DISAGREE',
      detail: `Vision chọn ${String.fromCharCode(65 + answer.choice)}, đáp án đánh dấu là ${String.fromCharCode(65 + key)}.`,
    };
  return { verdict: 'AGREE', detail: 'Vision chọn đúng đáp án đánh dấu.' };
}

// ---- review lifecycle ------------------------------------------------------

export function emptyReview(contentHash: string): GroupReview {
  return {
    status: 'UNREVIEWED',
    contentHash,
    steps: {},
    verdicts: [],
    edits: [],
    history: [],
  };
}

/** Recomputes status from steps and verdicts, unless an admin action set it. */
export function settleStatus(part: number, review: GroupReview): GroupReview {
  if (
    review.status === 'EDITED_BY_ADMIN' ||
    review.status === 'ADMIN_CONFIRMED'
  )
    return review;
  return {
    ...review,
    status: groupStatusOf(part, review.steps, review.verdicts),
  };
}

/**
 * Moves the current result into history, tied to the old hash, so it is never
 * shown as the result for the new content.
 */
export function invalidateReview(
  review: GroupReview,
  newHash: string,
  reason: string,
  now = new Date(),
): GroupReview {
  const hasResult =
    Object.keys(review.steps).length > 0 ||
    review.verdicts.length > 0 ||
    Boolean(review.confirmed);
  return {
    status: 'UNREVIEWED',
    contentHash: newHash,
    steps: {},
    verdicts: [],
    edits: review.edits ?? [],
    history: [
      ...(review.history ?? []),
      ...(hasResult || review.contentHash !== newHash
        ? [
            {
              contentHash: review.contentHash,
              status: review.status,
              steps: review.steps,
              verdicts: review.verdicts,
              ...(review.confirmed ? { confirmed: review.confirmed } : {}),
              staleAt: now.toISOString(),
              staleReason: reason,
            },
          ]
        : []),
    ],
  };
}

// ---- confirmation and apply --------------------------------------------------

type ConfirmRule = {
  part: 'P1' | 'P2_7';
  from: GroupReviewStatus;
  method: ConfirmationMethod;
};

/** The only confirmations allowed (owner's table). */
export const CONFIRMATION_RULES: ConfirmRule[] = [
  { part: 'P1', from: 'NEEDS_ADMIN_CONFIRM', method: 'AFTER_VISION' },
  { part: 'P1', from: 'UNREVIEWED', method: 'MANUAL_NO_VISION' },
  { part: 'P2_7', from: 'REVIEWED_DEGRADED', method: 'AFTER_DEGRADED_REVIEW' },
  { part: 'P2_7', from: 'UNREVIEWED', method: 'MANUAL_REVIEW' },
];

const partClass = (part: number) => (part === 1 ? 'P1' : 'P2_7');

export function confirmationRuleExists(
  part: number,
  from: GroupReviewStatus,
  method: ConfirmationMethod,
) {
  return CONFIRMATION_RULES.some(
    (rule) =>
      rule.part === partClass(part) &&
      rule.from === from &&
      rule.method === method,
  );
}

/**
 * Why a confirmation is refused, or null when it may be recorded. A step that
 * did not succeed is never treated as having succeeded.
 */
export function confirmationRefusal(input: {
  part: number;
  review: GroupReview;
  method: ConfirmationMethod;
  currentHash: string;
  anyQuestionFailed?: boolean;
}): string | null {
  const { part, review, method } = input;
  if (input.currentHash !== review.contentHash)
    return 'Nội dung đã thay đổi sau lần kiểm định; hãy kiểm định lại trước khi xác nhận.';
  if (review.status === 'REJECTED')
    return 'Nhóm bị bác bỏ không thể xác nhận; hãy sửa hoặc tạo lại.';
  if (!confirmationRuleExists(part, review.status, method))
    return `Không thể xác nhận nhóm Part ${part} ở trạng thái ${review.status} bằng phương thức ${method}.`;
  if (part === 1 && input.anyQuestionFailed)
    return 'Nhóm Part 1 còn câu FAILED; hãy sửa hoặc tạo lại câu đó.';
  const steps = review.steps;
  const allAgree = review.verdicts.every((row) => row.verdict === 'AGREE');
  switch (method) {
    case 'AFTER_VISION':
      return steps.part1VisionReview?.status === 'OK' && allAgree
        ? null
        : 'Vision chưa hoàn tất thành công; không thể xác nhận theo kết quả Vision.';
    case 'MANUAL_NO_VISION':
      return steps.part1VisionReview?.status === 'OK'
        ? 'Vision đã chạy xong; hãy xác nhận theo kết quả Vision.'
        : null;
    case 'AFTER_DEGRADED_REVIEW':
      return steps.independentSolve?.status === 'OK' &&
        steps.explanationCheck?.status === 'OK' &&
        allAgree
        ? null
        : 'Kiểm định chưa hoàn tất; không thể xác nhận.';
    case 'MANUAL_REVIEW':
      // Only a legacy group that never went through the reviewer.
      return Object.keys(steps).length === 0
        ? null
        : 'Nhóm đã được kiểm định một phần; hãy chạy lại kiểm định thay vì xác nhận thủ công.';
    default:
      return 'Phương thức xác nhận không hợp lệ.';
  }
}

export function confirmReview(
  review: GroupReview,
  confirmation: Omit<ReviewConfirmation, 'fromStatus' | 'contentHash'>,
): GroupReview {
  return {
    ...review,
    status: 'ADMIN_CONFIRMED',
    confirmed: {
      ...confirmation,
      contentHash: review.contentHash,
      fromStatus: review.status,
    },
  };
}

export type ApplyDecision = { ok: boolean; reason: string };

/**
 * Candidate Apply (Part 2-7 decided here; Part 1 waits for its Draft gate,
 * since its photo only exists after Apply). Structure is required for every
 * status: a confirmation never replaces the backend checks.
 */
export function canApply(input: {
  part: number;
  review?: GroupReview | null;
  currentHash: string;
  structureOk: boolean;
}): ApplyDecision {
  if (!input.structureOk) return { ok: false, reason: 'STRUCTURE_INVALID' };
  if (input.part === 1) return { ok: true, reason: 'PART1_DRAFT_GATE' };
  const review = input.review;
  if (!review) return { ok: false, reason: 'UNREVIEWED' };
  switch (review.status) {
    case 'REVIEWED_INDEPENDENT': {
      const solve = review.steps.independentSolve;
      const ok =
        solve?.status === 'OK' &&
        solve.reviewKind === 'INDEPENDENT' &&
        review.steps.explanationCheck?.status === 'OK' &&
        review.verdicts.length > 0 &&
        review.verdicts.every((row) => row.verdict === 'AGREE');
      if (!ok) return { ok: false, reason: 'REVIEW_INCOMPLETE' };
      return input.currentHash === review.contentHash
        ? { ok: true, reason: 'REVIEWED_INDEPENDENT' }
        : { ok: false, reason: 'HASH_MISMATCH' };
    }
    case 'EDITED_BY_ADMIN':
      return input.currentHash === review.contentHash
        ? { ok: true, reason: 'EDITED_BY_ADMIN' }
        : { ok: false, reason: 'HASH_MISMATCH' };
    case 'ADMIN_CONFIRMED': {
      const confirmed = review.confirmed;
      if (
        !confirmed ||
        !confirmationRuleExists(
          input.part,
          confirmed.fromStatus,
          confirmed.method,
        )
      )
        return { ok: false, reason: 'CONFIRMATION_INVALID' };
      return input.currentHash === confirmed.contentHash
        ? { ok: true, reason: 'ADMIN_CONFIRMED' }
        : { ok: false, reason: 'HASH_MISMATCH' };
    }
    default:
      return { ok: false, reason: review.status };
  }
}

/**
 * Part 1 publish gate on the Draft: an AI-written Part 1 group goes live only
 * when an admin confirmed exactly the current content and photo bytes.
 */
export function part1PublishRefusal(input: {
  review?: GroupReview | null;
  currentHash: string;
  questionFailed: boolean;
  imageSha256Stored?: string | null;
  imageSha256Now?: string | null;
}): string | null {
  if (!input.imageSha256Stored || !input.imageSha256Now)
    return 'IMAGE_VERSION_UNKNOWN';
  if (input.imageSha256Stored !== input.imageSha256Now) return 'IMAGE_CHANGED';
  if (input.questionFailed) return 'QUESTION_FAILED';
  const review = input.review;
  if (!review || review.status !== 'ADMIN_CONFIRMED' || !review.confirmed)
    return 'NOT_CONFIRMED';
  if (
    !confirmationRuleExists(
      1,
      review.confirmed.fromStatus,
      review.confirmed.method,
    )
  )
    return 'CONFIRMATION_INVALID';
  return review.confirmed.contentHash === input.currentHash
    ? null
    : 'HASH_MISMATCH';
}

/** Changed fields of one group edit, for the audit trail. */
export function diffGroup(before: ReviewGroup, after: ReviewGroup) {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const field of ['transcript', 'passageText', 'imageBrief'] as const)
    if ((before[field] ?? null) !== (after[field] ?? null))
      changes.push({
        field,
        before: before[field] ?? null,
        after: after[field] ?? null,
      });
  const count = Math.max(
    before.questions?.length ?? 0,
    after.questions?.length ?? 0,
  );
  for (let index = 0; index < count; index += 1) {
    const a = before.questions?.[index] ?? {};
    const b = after.questions?.[index] ?? {};
    for (const field of [
      'text',
      'options',
      'correctIndex',
      'explanation',
    ] as const)
      if (JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null))
        changes.push({
          field: `questions[${index}].${field}`,
          before: a[field] ?? null,
          after: b[field] ?? null,
        });
  }
  return changes;
}

export type { ReviewStep, ReviewStepName };
