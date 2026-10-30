/**
 * Gemini feedback rewording is optional enrichment after the Azure score is
 * persisted. Whatever Gemini does (time out, return garbage, be unavailable,
 * omit fields), the Azure score, metrics and Azure-derived feedback stay, and
 * no reward or grading is repeated.
 */
import { GeminiEvaluatorStrategy } from '../ai/strategies/gemini-evaluator.strategy';
import { SpeakingPostProcessingService } from './speaking-post-processing.service';

const AZURE_FEEDBACK =
  'Điểm phát âm: 9.6/10. Độ chính xác: 94%, Trôi chảy: 100%, Hoàn thiện: 100%.';
const azureAssessment = {
  overallScore: 9.6,
  clarity: 'Excellent',
  feedback: AZURE_FEEDBACK,
  suggestions: [],
  accuracyScore: 94,
  fluencyScore: 100,
  completenessScore: 100,
  problematicWords: [],
  transcript: 'the library opens at eight',
};

describe('Speaking feedback enrichment (Gemini) failure modes', () => {
  let service: SpeakingPostProcessingService;
  let prisma: any;
  let ai: any;
  let gamification: any;

  beforeEach(() => {
    prisma = {
      speakingSubmission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          userId: 2,
          status: 'COMPLETED',
          feedbackStatus: 'PENDING',
          overallScore: 9.6,
          aiFeedback: azureAssessment,
          exercise: {
            targetText: 'The library opens at eight',
            taskType: 'READ_ALOUD',
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    ai = {
      generatePronunciationFeedback: jest.fn(),
      assessPronunciation: jest.fn(),
    };
    gamification = { handleSpeakingSubmittedEvent: jest.fn() };
    service = new SpeakingPostProcessingService(prisma, ai, gamification);
    jest.spyOn((service as any).pubRedis, 'publish').mockResolvedValue(1);
  });
  afterEach(async () => {
    await service.onModuleDestroy();
  });

  const persisted = () =>
    prisma.speakingSubmission.updateMany.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.aiFeedback || d.feedbackStatus !== 'PROCESSING');

  it.each([
    [
      'timeout',
      () =>
        Promise.reject(
          Object.assign(new Error('The operation was aborted'), {
            name: 'AbortError',
          }),
        ),
    ],
    [
      'unavailable (503)',
      () =>
        Promise.reject(new Error('[503 Service Unavailable] model overloaded')),
    ],
    [
      'invalid JSON',
      () => Promise.reject(new SyntaxError('Unexpected token } in JSON')),
    ],
  ])(
    'Gemini %s: score untouched, feedback retried later, Azure not called, no reward',
    async (_label, fail) => {
      ai.generatePronunciationFeedback.mockImplementation(fail);
      // Not the last attempt: PENDING is stored and the error rethrown so the
      // queue retries the feedback job (bounded by maxAttempts).
      await expect(service.processFeedback(7, 'trace', 1, 4)).rejects.toThrow();
      const data = persisted();
      expect(data).toMatchObject({ feedbackStatus: 'PENDING' });
      expect(data.overallScore).toBeUndefined();
      expect(data.aiFeedback).toBeUndefined();
      expect(ai.assessPronunciation).not.toHaveBeenCalled();
      expect(gamification.handleSpeakingSubmittedEvent).not.toHaveBeenCalled();
    },
  );

  it('Gemini output without feedback or suggestions keeps the Azure feedback', async () => {
    // What the strategy returns when the JSON lacks those fields.
    ai.generatePronunciationFeedback.mockResolvedValue({
      clarity: 'Good',
      feedback: undefined,
      suggestions: undefined,
    });
    await service.processFeedback(7, 'trace', 1, 4);
    const merged = persisted().aiFeedback;
    expect(merged.feedback).toBe(AZURE_FEEDBACK);
    expect(merged.suggestions).toEqual([]);
    expect(merged.clarity).toBe('Excellent');
    expect(merged).toMatchObject({
      overallScore: 9.6,
      accuracyScore: 94,
      fluencyScore: 100,
      completenessScore: 100,
    });
  });

  it('an empty Gemini feedback string does not erase the Azure feedback', async () => {
    ai.generatePronunciationFeedback.mockResolvedValue({
      feedback: '   ',
      suggestions: [],
    });
    await service.processFeedback(7, 'trace', 1, 4);
    expect(persisted().aiFeedback.feedback).toBe(AZURE_FEEDBACK);
  });

  it('valid Gemini wording replaces only the wording, never the measured numbers', async () => {
    ai.generatePronunciationFeedback.mockResolvedValue({
      clarity: 'Poor',
      feedback: 'Bạn đọc rất rõ ràng, hãy giữ nhịp này nhé!',
      suggestions: ['Nhấn rõ âm cuối.'],
    });
    await service.processFeedback(7, 'trace', 1, 4);
    const merged = persisted().aiFeedback;
    expect(merged).toMatchObject({
      feedback: 'Bạn đọc rất rõ ràng, hãy giữ nhịp này nhé!',
      suggestions: ['Nhấn rõ âm cuối.'],
      clarity: 'Excellent',
      overallScore: 9.6,
      accuracyScore: 94,
    });
  });

  it('a duplicate feedback job after completion does nothing', async () => {
    prisma.speakingSubmission.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.processFeedback(7, 'trace-dup', 2, 4);
    expect(ai.generatePronunciationFeedback).not.toHaveBeenCalled();
  });
});

describe('Gemini feedback parser (generatePronunciationFeedback)', () => {
  const strategy = new GeminiEvaluatorStrategy() as any;
  const reply = (text: string) => {
    jest.spyOn(strategy, 'hasKeys').mockReturnValue(true);
    jest
      .spyOn(strategy, 'executeWithRotation')
      .mockResolvedValue({ response: { text: () => text } });
  };
  afterEach(() => jest.restoreAllMocks());

  it('text without JSON gives no wording (keeps Azure feedback)', async () => {
    reply('Xin lỗi, tôi không thể giúp.');
    await expect(
      strategy.generatePronunciationFeedback('t', azureAssessment),
    ).resolves.toEqual({});
  });

  it('truncated JSON (no closing brace) gives no wording', async () => {
    reply('{"feedback": "Tốt", ');
    await expect(
      strategy.generatePronunciationFeedback('t', azureAssessment),
    ).resolves.toEqual({});
  });

  it('malformed JSON is a failure for the retry path, not a grade change', async () => {
    reply('{"feedback": Tốt lắm}');
    await expect(
      strategy.generatePronunciationFeedback('t', azureAssessment),
    ).rejects.toThrow();
  });

  it('non-string suggestions are dropped', async () => {
    reply(
      '{"clarity":"Good","feedback":"Tốt lắm","suggestions":["a",3,null,"b"]}',
    );
    await expect(
      strategy.generatePronunciationFeedback('t', azureAssessment),
    ).resolves.toEqual({
      clarity: 'Good',
      feedback: 'Tốt lắm',
      suggestions: ['a', 'b'],
    });
  });
});
