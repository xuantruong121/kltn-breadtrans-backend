import { isAiOutage } from '../cloudflare-workers-ai.client';
import type { ReviewPrompt } from '../toeic-answer-review-prompt';

export type ReviewerImage = { buffer: Buffer; mimeType: string };

export type ReviewerReply = {
  data: unknown;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

/** One provider able to answer a review prompt with JSON. */
export interface AnswerReviewer {
  readonly name: 'cloudflare' | 'gemini' | 'openai-compatible';
  readonly supportsImages: boolean;
  configured(): boolean;
  model(): string;
  /** The company that made the model; null when it cannot be known. */
  vendor(): string | null;
  reviewJson(
    prompt: ReviewPrompt,
    image?: ReviewerImage,
  ): Promise<ReviewerReply>;
}

export const REVIEWER_UNAVAILABLE = 'ANSWER_REVIEW_UNAVAILABLE';

/** Raised when no reviewer could be reached: the job stops and can resume. */
export class ReviewerUnavailableError extends Error {
  readonly code = REVIEWER_UNAVAILABLE;
}

export function isReviewerUnavailable(error: unknown) {
  return (error as { code?: string })?.code === REVIEWER_UNAVAILABLE;
}

/** Thrown by a reviewer that answered but not with usable JSON. */
export class ReviewerOutputError extends Error {}

/**
 * Network failure, timeout, 429, 413, 5xx or missing credentials: the provider
 * could not be used. 413 is a request larger than the provider's per-minute
 * token limit (Groq), which no change of content fixes. Anything else (a reply
 * that is not JSON, a refusal) is an invalid answer, which a retry of the
 * content may fix.
 */
export function isProviderOutage(error: unknown) {
  if (error instanceof ReviewerOutputError) return false;
  if (isAiOutage(error)) return true;
  const status = Number(
    (error as any)?.status ?? (error as any)?.statusCode ?? NaN,
  );
  if (
    status === 429 ||
    status === 413 ||
    status === 401 ||
    status === 403 ||
    status >= 500
  )
    return true;
  const text = String((error as Error)?.message ?? error).toLowerCase();
  return (
    (error as Error)?.name === 'AbortError' ||
    (error as Error)?.name === 'TimeoutError' ||
    /fetch failed|econnrefused|enotfound|timed? ?out|network|not configured|credentials/.test(
      text,
    )
  );
}
