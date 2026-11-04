/* eslint-disable @typescript-eslint/require-await */
import { AiGenerationJobStatus, QuizPublicationStatus } from '@prisma/client';
import { ToeicAiExamService } from './toeic-ai-exam.service';
import { AnswerReviewService } from '../ai/review/answer-review.service';
import type { AnswerReviewer } from '../ai/review/answer-reviewer';
import { CLOUDFLARE_UNAVAILABLE } from '../ai/cloudflare-workers-ai.client';
import { canonicalGroupHash } from './toeic-answer-review.logic';

jest.mock('./toeic.validation', () => ({
  validateToeicExam: () => ({ learnerReady: true, issues: [] }),
}));

/** The key is the option ending in "*"; the generator shuffles options. */
const MARK = '*';
let sequence = 0;
function part5Batch(questionCount: number) {
  return {
    groups: Array.from({ length: questionCount }, () => {
      const n = sequence++;
      return {
        questions: [
          {
            text: `The manager ${n} _____ the report yesterday.`,
            options: [
              `reviewed-${n}${MARK}`,
              `reviews-${n}`,
              `reviewing-${n}`,
              `review-${n}`,
            ],
            correctIndex: 0,
            explanation: `Câu có trạng từ chỉ quá khứ nên cần động từ quá khứ ${n}.`,
          },
        ],
      };
    }),
  };
}

const dataOf = (prompt: { prompt: string }) =>
  JSON.parse(prompt.prompt.split('DATA:\n')[1]);
const keyOf = (options: string[]) =>
  options.findIndex((option) => option.endsWith(MARK));

type Mode = 'agree' | 'disagree' | 'outage' | 'invalid';

function reviewer(
  name: AnswerReviewer['name'],
  modes: { solve?: Mode[]; explain?: Mode[] },
  calls: { solve: number; explain: number },
): AnswerReviewer & { reviewJson: jest.Mock } {
  const next = (list: Mode[] | undefined) =>
    list && list.length > 1 ? list.shift()! : (list?.[0] ?? 'agree');
  return {
    name,
    supportsImages: name === 'gemini',
    configured: () => true,
    model: () =>
      name === 'gemini' ? 'gemini-test' : '@cf/openai/gpt-oss-120b',
    vendor: () => (name === 'gemini' ? 'google' : 'openai'),
    reviewJson: jest.fn(async (prompt: any) => {
      const explaining = 'checks' in (prompt.schema.properties ?? {});
      const mode = explaining ? next(modes.explain) : next(modes.solve);
      if (explaining) calls.explain += 1;
      else calls.solve += 1;
      if (mode === 'outage')
        throw Object.assign(new Error('provider down'), {
          code: CLOUDFLARE_UNAVAILABLE,
        });
      if (mode === 'invalid') return { data: { nothing: true }, model: 'm' };
      const questions = dataOf(prompt).groups.flatMap((g: any) => g.questions);
      const pick = (q: any) => {
        const key = keyOf(q.options);
        return mode === 'disagree' ? (key + 1) % q.options.length : key;
      };
      return {
        model: name === 'gemini' ? 'gemini-test' : '@cf/openai/gpt-oss-120b',
        data: explaining
          ? {
              checks: questions.map((q: any) => ({
                id: q.id,
                claimedChoice: pick(q),
                supportsClaim: true,
                containsContradiction: false,
                reasoning: 'checked',
              })),
            }
          : {
              answers: questions.map((q: any) => ({
                id: q.id,
                choice: pick(q),
                alsoCorrect: [],
                answerable: true,
                evidence: [],
                reasoning: 'solved',
                evidenceSupportsAnswer: true,
              })),
            },
      };
    }),
  };
}

function harness(
  plan: Record<number, Array<{ questionCount: number }>>,
  modes: { cloudflare?: Mode[]; geminiSolve?: Mode[]; explain?: Mode[] } = {},
) {
  sequence = 0;
  const calls = { solve: 0, explain: 0 };
  const runtimeJob: any = {
    id: 'job',
    createdByAdminId: 1,
    status: AiGenerationJobStatus.QUEUED,
    requestSnapshot: {
      kind: 'TOEIC_PRACTICE_EXAM',
      mode: 'FULL_EXAM',
      variantCode: 'TOEIC_LR',
      difficulty: 'medium',
      plan,
    },
    resultSnapshot: { parts: {} },
    draftSnapshot: null,
    approvedSnapshot: null,
  };
  const tx = {
    toeicQuestionGroup: { deleteMany: jest.fn(), create: jest.fn() },
  };
  const prisma: any = {
    aiGenerationJob: {
      findUnique: jest.fn(async () => runtimeJob),
      findUniqueOrThrow: jest.fn(async () => ({
        resultSnapshot: runtimeJob.resultSnapshot,
        status: runtimeJob.status,
      })),
      update: jest.fn(async ({ data }: any) => {
        if (data.status) runtimeJob.status = data.status;
        if ('draftSnapshot' in data)
          runtimeJob.draftSnapshot = JSON.parse(
            JSON.stringify(data.draftSnapshot),
          );
        if (data.resultSnapshot)
          runtimeJob.resultSnapshot = data.resultSnapshot;
        if (data.approvedSnapshot)
          runtimeJob.approvedSnapshot = data.approvedSnapshot;
        return runtimeJob;
      }),
    },
    exam: {
      findUnique: jest.fn(async () => ({
        id: 814,
        title: 'Đề',
        publicationStatus: QuizPublicationStatus.DRAFT,
        toeicExamSet: { id: 22, difficulty: 'medium' },
        toeicAssessment: null,
      })),
    },
    toeicAttempt: { count: jest.fn(async () => 0) },
    toeicAssessmentAttempt: { count: jest.fn(async () => 0) },
    toeicQuestionGroup: { create: jest.fn() },
    toeicExamSet: { findUniqueOrThrow: jest.fn(async () => ({ groups: [] })) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const ai = {
    generateToeicExamBatch: jest.fn(async (input: any) =>
      part5Batch(input.groups.length),
    ),
  };
  const cloudflare = reviewer('cloudflare', { solve: modes.cloudflare }, calls);
  const gemini = reviewer(
    'gemini',
    { solve: modes.geminiSolve, explain: modes.explain },
    calls,
  );
  const answerReview = new AnswerReviewService(
    { textModel: () => '@cf/openai/gpt-oss-120b' } as any,
    {} as any,
    {} as any,
  );
  answerReview.useReviewers([cloudflare, gemini]);
  const service: any = Object.create(ToeicAiExamService.prototype);
  Object.assign(service, {
    prisma,
    ai,
    answerReview,
    logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
    queue: {
      getJob: jest.fn(async () => null),
      add: jest.fn(async () => undefined),
    },
    genericExam: {
      hasLearnerAttempts: jest.fn(async () => false),
      missingImages: jest.fn(async () => []),
    },
    materializeMedia: jest.fn(async () => undefined),
  });
  return { service, runtimeJob, ai, calls, cloudflare, gemini, tx };
}

const groupsOf = (job: any) =>
  job.draftSnapshot.lrBatches.flatMap((batch: any) => batch.candidate.groups);

describe('answer review inside generation', () => {
  it('reviews every Part 2-7 batch: independent solve, then the explanation check', async () => {
    const h = harness({
      5: Array.from({ length: 3 }, () => ({ questionCount: 1 })),
    });
    await h.service.process({ data: { jobId: 'job' } });
    expect(h.runtimeJob.status).toBe(AiGenerationJobStatus.GENERATED);
    const [group] = groupsOf(h.runtimeJob);
    expect(group.review).toMatchObject({
      status: 'REVIEWED_INDEPENDENT',
      contentHash: canonicalGroupHash(5, group),
      steps: {
        independentSolve: {
          provider: 'cloudflare',
          reviewKind: 'INDEPENDENT',
          status: 'OK',
        },
        explanationCheck: {
          provider: 'gemini',
          reviewKind: 'SAME_PROVIDER',
          status: 'OK',
        },
      },
    });
    expect(group.review.verdicts[0]).toMatchObject({ verdict: 'AGREE' });
    // One solve call and one explanation call for the batch of three.
    expect(h.calls).toEqual({ solve: 1, explain: 1 });
  });

  it('a valid disagreement redrafts with the reason, then keeps the refused batch', async () => {
    const h = harness(
      { 5: [{ questionCount: 1 }] },
      { cloudflare: ['disagree'] },
    );
    await h.service.process({ data: { jobId: 'job' } });
    expect(h.ai.generateToeicExamBatch).toHaveBeenCalledTimes(3);
    expect(h.ai.generateToeicExamBatch.mock.calls[1][0].retryNote).toContain(
      'Kiểm định đáp án bác bỏ',
    );
    // No provider after the valid disagreement and no explanation check.
    expect(h.gemini.reviewJson).not.toHaveBeenCalled();
    expect(h.runtimeJob.draftSnapshot.failedUnits).toEqual([
      expect.objectContaining({
        batchKey: '5:0',
        code: 'ANSWER_REVIEW_FAILED',
      }),
    ]);
    const groups = groupsOf(h.runtimeJob);
    expect(groups).toHaveLength(1);
    expect(groups[0].review.status).toBe('REJECTED');
    expect(groups[0].review.verdicts[0].verdict).toBe('DISAGREE');
  });

  it('an explanation outage stops the job; resume runs only that step', async () => {
    const h = harness(
      { 5: [{ questionCount: 1 }] },
      { explain: ['outage', 'agree'] },
    );
    await expect(h.service.process({ data: { jobId: 'job' } })).rejects.toThrow(
      'Kiểm tra giải thích tạm thời không khả dụng',
    );
    expect(h.runtimeJob.status).toBe(AiGenerationJobStatus.FAILED);
    const stored = groupsOf(h.runtimeJob)[0];
    expect(stored.review.steps.independentSolve.status).toBe('OK');
    expect(stored.review.steps.explanationCheck.status).toBe('UNAVAILABLE');
    expect(h.runtimeJob.resultSnapshot.failedScope).toEqual({
      kind: 'batch',
      part: 5,
      offset: 0,
    });

    await h.service.retry('job', 1);
    await h.service.process({ data: { jobId: 'job' } });
    expect(h.ai.generateToeicExamBatch).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual({ solve: 1, explain: 2 });
    expect(h.runtimeJob.status).toBe(AiGenerationJobStatus.GENERATED);
    expect(h.runtimeJob.draftSnapshot.lrBatches).toHaveLength(1);
    expect(h.runtimeJob.draftSnapshot.failedUnits).toEqual([]);
    expect(groupsOf(h.runtimeJob)[0].review.status).toBe(
      'REVIEWED_INDEPENDENT',
    );
  });

  it('a stop before any review step resumes on the saved content', async () => {
    const h = harness(
      { 5: [{ questionCount: 1 }] },
      { cloudflare: ['outage', 'agree'], geminiSolve: ['outage', 'agree'] },
    );
    await expect(h.service.process({ data: { jobId: 'job' } })).rejects.toThrow(
      'Kiểm định đáp án tạm thời không khả dụng',
    );
    const savedText = groupsOf(h.runtimeJob)[0].questions[0].text;
    expect(groupsOf(h.runtimeJob)[0].review.steps.independentSolve.status).toBe(
      'UNAVAILABLE',
    );
    await h.service.retry('job', 1);
    await h.service.process({ data: { jobId: 'job' } });
    expect(h.ai.generateToeicExamBatch).toHaveBeenCalledTimes(1);
    expect(groupsOf(h.runtimeJob)[0].questions[0].text).toBe(savedText);
    expect(h.runtimeJob.draftSnapshot.lrBatches).toHaveLength(1);
  });

  it('Gemini answering for Cloudflare is degraded and needs a confirmation to Apply', async () => {
    const h = harness(
      { 5: [{ questionCount: 1 }] },
      { cloudflare: ['outage'] },
    );
    await h.service.process({ data: { jobId: 'job' } });
    const [group] = groupsOf(h.runtimeJob);
    expect(group.review.status).toBe('REVIEWED_DEGRADED');
    expect(group.review.steps.independentSolve).toMatchObject({
      provider: 'gemini',
      reviewKind: 'SAME_PROVIDER',
    });

    const first = await h.service.apply('job', 1, ['LR:P5:G1']);
    expect(first.skipped).toEqual([
      { candidateKey: 'LR:P5:G1', reason: 'REVIEWED_DEGRADED' },
    ]);
    expect(h.tx.toeicQuestionGroup.create).not.toHaveBeenCalled();

    await expect(
      h.service.confirmCandidate('job', 1, 'LR:P5:G1', 'MANUAL_REVIEW'),
    ).rejects.toThrow();
    await h.service.confirmCandidate(
      'job',
      1,
      'LR:P5:G1',
      'AFTER_DEGRADED_REVIEW',
    );
    const second = await h.service.apply('job', 1, ['LR:P5:G1']);
    expect(second.skipped).toEqual([]);
    expect(h.tx.toeicQuestionGroup.create).toHaveBeenCalledTimes(1);
    expect(h.runtimeJob.status).toBe(AiGenerationJobStatus.APPROVED);
  });

  it('an admin edit files the old review as history and Apply re-checks structure', async () => {
    const h = harness({ 5: [{ questionCount: 1 }, { questionCount: 1 }] });
    await h.service.process({ data: { jobId: 'job' } });
    await h.service.updateCandidate('job', 1, 'LR:P5:G1', {
      questions: [
        {
          questionIndex: 0,
          explanation:
            'Trạng từ yesterday chỉ quá khứ nên chọn động từ quá khứ.',
        },
      ],
    });
    // A second edit breaks the structure of the other group.
    await h.service.updateCandidate('job', 1, 'LR:P5:G2', {
      questions: [{ questionIndex: 0, explanation: 'ngắn' }],
    });
    const [edited, broken] = groupsOf(h.runtimeJob);
    expect(edited.review.status).toBe('EDITED_BY_ADMIN');
    expect(edited.review.steps).toEqual({});
    expect(edited.review.verdicts).toEqual([]);
    expect(edited.review.history[0]).toMatchObject({
      status: 'REVIEWED_INDEPENDENT',
      staleReason: 'ADMIN_EDIT',
    });
    expect(edited.review.edits[0].changes[0].field).toBe(
      'questions[0].explanation',
    );

    const result = await h.service.apply('job', 1);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        candidateKey: 'LR:P5:G2',
        reason: expect.stringContaining('STRUCTURE_INVALID'),
      }),
    ]);
    expect(h.tx.toeicQuestionGroup.create).toHaveBeenCalledTimes(1);
    expect(broken.review.status).toBe('EDITED_BY_ADMIN');
    expect(h.runtimeJob.status).toBe(AiGenerationJobStatus.GENERATED);
  });

  it('content changed behind the review is held back by its hash', async () => {
    const h = harness({ 5: [{ questionCount: 1 }] });
    await h.service.process({ data: { jobId: 'job' } });
    groupsOf(h.runtimeJob)[0].questions[0].explanation =
      'Một lời giải thích khác được ghi thẳng vào snapshot ngoài luồng.';
    const result = await h.service.apply('job', 1);
    expect(result.skipped).toEqual([
      { candidateKey: 'LR:P5:G1', reason: 'HASH_MISMATCH' },
    ]);
    // Nothing applied, so apply-all did not wipe the Draft either.
    expect(h.tx.toeicQuestionGroup.deleteMany).not.toHaveBeenCalled();
  });

  it('a legacy unreviewed group needs a manual review confirmation', async () => {
    const h = harness({ 5: [{ questionCount: 1 }] });
    await h.service.process({ data: { jobId: 'job' } });
    delete groupsOf(h.runtimeJob)[0].review;
    expect((await h.service.apply('job', 1)).skipped[0].reason).toBe(
      'UNREVIEWED',
    );
    await h.service.confirmCandidate('job', 1, 'LR:P5:G1', 'MANUAL_REVIEW');
    expect(groupsOf(h.runtimeJob)[0].review.confirmed).toMatchObject({
      method: 'MANUAL_REVIEW',
      fromStatus: 'UNREVIEWED',
    });
    expect((await h.service.apply('job', 1)).skipped).toEqual([]);
  });

  it('a refused group regenerated by the admin clears the review failure', async () => {
    const h = harness(
      { 5: [{ questionCount: 1 }] },
      { cloudflare: ['disagree', 'disagree', 'disagree', 'agree'] },
    );
    await h.service.process({ data: { jobId: 'job' } });
    expect(h.runtimeJob.draftSnapshot.failedUnits).toHaveLength(1);
    await h.service.regenerateCandidateGroup('job', 1, 'LR:P5:G1');
    expect(groupsOf(h.runtimeJob)[0].review.status).toBe(
      'REVIEWED_INDEPENDENT',
    );
    expect(h.runtimeJob.draftSnapshot.failedUnits).toEqual([]);
  });

  it('a regenerated group the reviewer refuses is not saved', async () => {
    const h = harness(
      { 5: [{ questionCount: 1 }] },
      { cloudflare: ['agree', 'disagree'] },
    );
    await h.service.process({ data: { jobId: 'job' } });
    const before = groupsOf(h.runtimeJob)[0].questions[0].text;
    await expect(
      h.service.regenerateCandidateGroup('job', 1, 'LR:P5:G1'),
    ).rejects.toThrow('Kiểm định đáp án bác bỏ');
    expect(groupsOf(h.runtimeJob)[0].questions[0].text).toBe(before);
  });

  it('Part 1 candidates are not sent to the text reviewer and confirm on the Draft', async () => {
    const h = harness({});
    h.runtimeJob.status = AiGenerationJobStatus.GENERATED;
    h.runtimeJob.draftSnapshot = {
      version: 1,
      lrBatches: [
        {
          batchKey: '1:0',
          part: 1,
          groupOrder: 1,
          questionNumber: 1,
          candidate: {
            groups: [
              {
                imageBrief: 'A man at a desk',
                questions: [
                  {
                    text: null,
                    options: [
                      'He is typing on a keyboard.',
                      'He is closing a window.',
                      'He is carrying a box.',
                      'He is watering a plant.',
                    ],
                    correctIndex: 0,
                    explanation:
                      'Người đàn ông đang gõ bàn phím tại bàn làm việc.',
                  },
                ],
              },
            ],
          },
        },
      ],
      failedUnits: [],
    };
    await expect(
      h.service.confirmCandidate('job', 1, 'LR:P1:G1', 'AFTER_VISION'),
    ).rejects.toThrow('Draft');
    const result = await h.service.apply('job', 1);
    expect(result.skipped).toEqual([]);
    expect(h.calls).toEqual({ solve: 0, explain: 0 });
  });
});
