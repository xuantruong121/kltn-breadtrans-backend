/* eslint-disable @typescript-eslint/require-await */
import { createHash } from 'crypto';
import { ToeicAiExamService } from './toeic-ai-exam.service';
import { AnswerReviewService } from '../ai/review/answer-review.service';
import type { AnswerReviewer } from '../ai/review/answer-reviewer';
import { CLOUDFLARE_UNAVAILABLE } from '../ai/cloudflare-workers-ai.client';
import { part1DraftHash } from './toeic-answer-review.logic';

const sha = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');
const PHOTO = Buffer.from('photo-bytes-v1');
const OTHER_PHOTO = Buffer.from('photo-bytes-v2');
const URL = 'https://pub.r2.dev/ai/toeic-exams/exam-22/groups/7/image.jpg';

function vision(mode: 'agree' | 'disagree' | 'outage') {
  const calls: any[] = [];
  const reviewer: AnswerReviewer = {
    name: 'gemini',
    supportsImages: true,
    configured: () => true,
    model: () => 'gemini-vision-test',
    vendor: () => 'google',
    reviewJson: async (prompt: any, image: any) => {
      calls.push({ prompt, image });
      if (mode === 'outage')
        throw Object.assign(new Error('down'), {
          code: CLOUDFLARE_UNAVAILABLE,
        });
      return {
        model: 'gemini-vision-test',
        data: {
          choice: mode === 'agree' ? 1 : 2,
          alsoCorrect: [],
          answerable: true,
          reasoning: 'visible',
        },
      };
    },
  };
  const service = new AnswerReviewService(
    { textModel: () => '@cf/openai/gpt-oss-120b' } as any,
    {} as any,
    {} as any,
  );
  service.useReviewers([reviewer]);
  return { service, calls };
}

function draftGroup(overrides: Record<string, any> = {}) {
  return {
    id: 7,
    part: 1,
    groupOrder: 1,
    imageBrief: 'A man at a desk',
    imageUrl: URL,
    transcriptText: null,
    passageText: null,
    mediaMetadata: { source: 'AI_GENERATED', image: {} as Record<string, any> },
    questions: [
      {
        id: 70,
        questionNumber: 1,
        text: 'Choose the sentence that best describes the photograph.',
        options: [
          'He is closing a window.',
          'He is typing on a keyboard.',
          'He is carrying a box.',
          'He is watering a plant.',
        ],
        correctIndex: 1,
        explanation: 'Người đàn ông đang gõ bàn phím.',
      },
    ],
    ...overrides,
  };
}

function build(mode: 'agree' | 'disagree' | 'outage', group = draftGroup()) {
  const { service: answerReview, calls } = vision(mode);
  const updates: any[] = [];
  const service: any = Object.create(ToeicAiExamService.prototype);
  Object.assign(service, {
    answerReview,
    logger: { warn: jest.fn() },
    r2: { getPublicUrl: () => 'https://pub.r2.dev' },
    imageSearch: {
      validateBuffer: (buffer: Buffer, mimeType: string) => ({
        buffer,
        mimeType,
      }),
    },
    prisma: {
      exam: {
        findUnique: jest.fn(async () => ({
          publicationStatus: 'DRAFT',
          toeicExamSet: { id: 22, _count: { attempts: 0 } },
        })),
      },
      toeicQuestionGroup: {
        findFirst: jest.fn(async () => group),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          group.mediaMetadata = data.mediaMetadata;
          return group;
        }),
      },
    },
  });
  return { service, calls, updates, group };
}

function serveBytes(buffer: Buffer) {
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => buffer,
  }));
}

describe('Part 1 answer review on the Draft', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('Vision sees the photo and statements, never the key; agreement waits for the admin', async () => {
    const { service, calls, group } = build('agree');
    const image: Record<string, any> = { r2Key: 'k' };
    await service.reviewPart1DraftGroup(
      group,
      image,
      { buffer: PHOTO, mimeType: 'image/jpeg' },
      URL,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].image.buffer).toBe(PHOTO);
    expect(calls[0].prompt.prompt).not.toMatch(
      /correctIndex|explanation|gõ bàn phím/,
    );
    expect(image.imageHash).toBe(sha(PHOTO));
    expect(image.review).toMatchObject({
      status: 'NEEDS_ADMIN_CONFIRM',
      steps: { part1VisionReview: { status: 'OK', provider: 'gemini' } },
      contentHash: part1DraftHash(group, {
        r2Key: 'k',
        url: URL,
        sha256: sha(PHOTO),
      }),
    });
  });

  it('a different Vision pick marks the question FAILED and blocks confirmation', async () => {
    const { service, group } = build('disagree');
    const image: Record<string, any> = { r2Key: 'k' };
    await service.reviewPart1DraftGroup(
      group,
      image,
      { buffer: PHOTO, mimeType: 'image/jpeg' },
      URL,
    );
    expect(image.questionStatus).toBe('FAILED');
    expect(image.review.status).toBe('REJECTED');
    group.mediaMetadata = { source: 'AI_GENERATED', image };
    serveBytes(PHOTO);
    await expect(
      service.confirmPart1Draft(1, 7, 9, 'AFTER_VISION'),
    ).rejects.toThrow();
    await expect(
      service.confirmPart1Draft(1, 7, 9, 'MANUAL_NO_VISION'),
    ).rejects.toThrow();
  });

  it('confirms after Vision, bound to the current question and photo bytes', async () => {
    const { service, group } = build('agree');
    const image: Record<string, any> = { r2Key: 'k' };
    await service.reviewPart1DraftGroup(
      group,
      image,
      { buffer: PHOTO, mimeType: 'image/jpeg' },
      URL,
    );
    group.mediaMetadata = { source: 'AI_GENERATED', image };
    serveBytes(PHOTO);
    await expect(
      service.confirmPart1Draft(1, 7, 9, 'MANUAL_NO_VISION'),
    ).rejects.toThrow('MANUAL_NO_VISION');
    const result = await service.confirmPart1Draft(1, 7, 9, 'AFTER_VISION');
    expect(result.image.review).toMatchObject({
      status: 'ADMIN_CONFIRMED',
      confirmed: {
        by: 9,
        method: 'AFTER_VISION',
        fromStatus: 'NEEDS_ADMIN_CONFIRM',
      },
    });
  });

  it('new bytes behind the same URL and key retire the review', async () => {
    const { service, group } = build('agree');
    const image: Record<string, any> = { r2Key: 'k' };
    await service.reviewPart1DraftGroup(
      group,
      image,
      { buffer: PHOTO, mimeType: 'image/jpeg' },
      URL,
    );
    group.mediaMetadata = { source: 'AI_GENERATED', image };
    serveBytes(OTHER_PHOTO);
    await expect(
      service.confirmPart1Draft(1, 7, 9, 'AFTER_VISION'),
    ).rejects.toThrow('đã thay đổi');
    const saved = group.mediaMetadata.image;
    expect(saved.imageHash).toBe(sha(OTHER_PHOTO));
    expect(saved.review.status).toBe('UNREVIEWED');
    expect(saved.review.history[0]).toMatchObject({
      status: 'NEEDS_ADMIN_CONFIRM',
      staleReason: 'IMAGE_CHANGED',
    });
  });

  it('a Vision outage leaves the group UNREVIEWED; only a manual confirmation fits', async () => {
    const { service, group } = build('outage');
    const image: Record<string, any> = { r2Key: 'k' };
    await service.reviewPart1DraftGroup(
      group,
      image,
      { buffer: PHOTO, mimeType: 'image/jpeg' },
      URL,
    );
    expect(image.review.status).toBe('UNREVIEWED');
    expect(image.review.steps.part1VisionReview.status).toBe('UNAVAILABLE');
    group.mediaMetadata = { source: 'AI_GENERATED', image };
    serveBytes(PHOTO);
    await expect(
      service.confirmPart1Draft(1, 7, 9, 'AFTER_VISION'),
    ).rejects.toThrow();
    const result = await service.confirmPart1Draft(1, 7, 9, 'MANUAL_NO_VISION');
    expect(result.image.review.confirmed.method).toBe('MANUAL_NO_VISION');
    // The Vision step is never rewritten as a success.
    expect(result.image.review.steps.part1VisionReview.status).toBe(
      'UNAVAILABLE',
    );
  });

  it('editing the FAILED question itself clears FAILED and retires the review', async () => {
    const { service, group } = build('disagree');
    const image: Record<string, any> = { r2Key: 'k' };
    await service.reviewPart1DraftGroup(
      group,
      image,
      { buffer: PHOTO, mimeType: 'image/jpeg' },
      URL,
    );
    group.mediaMetadata = { source: 'AI_GENERATED', image };
    group.questions[0].correctIndex = 2;
    serveBytes(PHOTO);
    await expect(
      service.confirmPart1Draft(1, 7, 9, 'MANUAL_NO_VISION'),
    ).rejects.toThrow('đã thay đổi');
    expect(group.mediaMetadata.image.questionStatus).toBe('READY_FOR_REVIEW');
    expect(group.mediaMetadata.image.review.status).toBe('UNREVIEWED');
  });
});
