/**
 * Test helpers for the answer review: build the review a group would carry
 * after an independent review that agreed with every key. Not used at runtime.
 */
import { canonicalGroupHash } from './toeic-answer-review.logic';
import type { GroupReview, ReviewStep } from './toeic-answer-review.types';

export function okStep(
  provider = 'cloudflare',
  model = '@cf/openai/gpt-oss-120b',
  reviewKind: ReviewStep['reviewKind'] = 'INDEPENDENT',
): ReviewStep {
  return {
    provider,
    model,
    modelVendor: provider === 'gemini' ? 'google' : 'openai',
    reviewKind,
    status: 'OK',
    promptVersion: 'test',
    at: '2026-11-03T00:00:00.000Z',
    tried: [],
  };
}

export function independentReviewOf(
  part: number,
  group: any,
  firstQuestionNumber = 1,
): GroupReview {
  return {
    status: 'REVIEWED_INDEPENDENT',
    contentHash: canonicalGroupHash(part, group),
    steps: {
      independentSolve: okStep(),
      explanationCheck: okStep('gemini', 'gemini-test', 'SAME_PROVIDER'),
    },
    verdicts: (group.questions ?? []).map((_: unknown, index: number) => ({
      questionNumber: firstQuestionNumber + index,
      verdict: 'AGREE' as const,
      solve: { verdict: 'AGREE' as const, detail: 'ok' },
      explanation: { verdict: 'AGREE' as const, detail: 'ok' },
    })),
    edits: [],
    history: [],
  };
}

/** Stamps an agreeing independent review on every group of a draft snapshot. */
export function reviewedSnapshot<T extends { lrBatches?: any[] }>(
  snapshot: T,
): T {
  for (const batch of snapshot.lrBatches ?? []) {
    let questionNumber = Number(batch.questionNumber ?? 1);
    for (const group of batch.candidate?.groups ?? []) {
      if (Number(batch.part) !== 1)
        group.review = independentReviewOf(
          Number(batch.part),
          group,
          questionNumber,
        );
      questionNumber += group.questions?.length ?? 0;
    }
  }
  return snapshot;
}

/**
 * Replaces the provider calls of the review with an agreeing reviewer, so
 * specs about the generation pipeline keep testing only the pipeline.
 */
export function withAgreeingReview(service: any) {
  service.reviewBatch = jest.fn(
    async (batch: any, persist: () => Promise<void>) => {
      let questionNumber = Number(batch.questionNumber ?? 1);
      for (const group of batch.candidate?.groups ?? []) {
        if (
          group.review?.status !== 'EDITED_BY_ADMIN' &&
          group.review?.status !== 'ADMIN_CONFIRMED'
        )
          group.review = independentReviewOf(
            Number(batch.part),
            group,
            questionNumber,
          );
        questionNumber += group.questions?.length ?? 0;
      }
      await persist();
      return { accepted: true, refusal: '' };
    },
  );
  return service;
}
