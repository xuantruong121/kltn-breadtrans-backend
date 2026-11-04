/**
 * Answer review of AI-written TOEIC items. Stored inside the job's
 * draftSnapshot (Part 2-7 candidates) and inside mediaMetadata.image.review
 * (Part 1 Draft groups); no table of its own.
 */

export const QUESTION_VERDICTS = [
  'AGREE',
  'DISAGREE',
  'AMBIGUOUS',
  'UNANSWERABLE',
  'EVIDENCE_NOT_FOUND',
  'EVIDENCE_INSUFFICIENT',
  'EXPLANATION_MISMATCH',
  'REVIEW_INVALID',
] as const;
export type QuestionVerdict = (typeof QUESTION_VERDICTS)[number];

export const GROUP_REVIEW_STATUSES = [
  'REVIEWED_INDEPENDENT',
  'REVIEWED_DEGRADED',
  'NEEDS_ADMIN_CONFIRM',
  'REJECTED',
  'EDITED_BY_ADMIN',
  'ADMIN_CONFIRMED',
  'UNREVIEWED',
] as const;
export type GroupReviewStatus = (typeof GROUP_REVIEW_STATUSES)[number];

export type ReviewKind = 'INDEPENDENT' | 'SAME_PROVIDER';
export type ReviewStepStatus = 'OK' | 'INVALID' | 'UNAVAILABLE';
export type ReviewStepName =
  'independentSolve' | 'explanationCheck' | 'part1VisionReview';

export type ReviewStep = {
  provider: string | null;
  model: string | null;
  modelVendor: string | null;
  reviewKind: ReviewKind;
  status: ReviewStepStatus;
  promptVersion: string;
  at: string;
  /** Every provider asked, in order, and why it was passed over. */
  tried: Array<{ provider: string; model: string; reason: string }>;
  usage?: { inputTokens?: number; outputTokens?: number; neurons?: number };
};

export type ExplanationCause =
  'WRONG_CHOICE' | 'DOES_NOT_SUPPORT' | 'CONTRADICTION';

export type QuestionReview = {
  questionNumber: number;
  /** The combined result: the first verdict that is not AGREE, else AGREE. */
  verdict: QuestionVerdict;
  solve?: {
    verdict: QuestionVerdict;
    detail: string;
    choice?: number;
    alsoCorrect?: number[];
    answerable?: boolean;
    evidence?: string[];
    evidenceSupportsAnswer?: boolean;
    reasoning?: string;
  };
  explanation?: {
    verdict: QuestionVerdict;
    detail: string;
    causes?: ExplanationCause[];
    claimedChoice?: number;
    reasoning?: string;
  };
  vision?: {
    verdict: QuestionVerdict;
    detail: string;
    choice?: number;
    reasoning?: string;
  };
};

export const CONFIRMATION_METHODS = [
  'AFTER_VISION',
  'MANUAL_NO_VISION',
  'AFTER_DEGRADED_REVIEW',
  'MANUAL_REVIEW',
] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

export type ReviewConfirmation = {
  by: number;
  at: string;
  contentHash: string;
  method: ConfirmationMethod;
  fromStatus: GroupReviewStatus;
};

export type ReviewEdit = {
  by: number;
  at: string;
  contentHashBefore: string;
  contentHashAfter: string;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
};

export type ReviewHistoryEntry = {
  contentHash: string;
  status: GroupReviewStatus;
  steps: Partial<Record<ReviewStepName, ReviewStep>>;
  verdicts: QuestionReview[];
  confirmed?: ReviewConfirmation;
  staleAt: string;
  staleReason: string;
};

export type GroupReview = {
  status: GroupReviewStatus;
  contentHash: string;
  steps: Partial<Record<ReviewStepName, ReviewStep>>;
  verdicts: QuestionReview[];
  edits: ReviewEdit[];
  confirmed?: ReviewConfirmation;
  history: ReviewHistoryEntry[];
};
