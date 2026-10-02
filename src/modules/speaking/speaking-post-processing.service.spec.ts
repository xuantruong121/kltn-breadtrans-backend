/* eslint-disable @typescript-eslint/no-unsafe-call */
import { SpeakingPostProcessingService } from './speaking-post-processing.service';

describe('SpeakingPostProcessingService', () => {
  let service: SpeakingPostProcessingService;
  let prisma: any;
  let ai: any;
  let gamification: any;

  beforeEach(() => {
    prisma = {
      speakingSubmission: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    ai = {
      generatePronunciationFeedback: jest
        .fn()
        .mockResolvedValue({ feedback: 'Chi tiết' }),
      assessPronunciation: jest.fn(),
    };
    gamification = {
      handleSpeakingSubmittedEvent: jest.fn().mockResolvedValue(undefined),
    };
    service = new SpeakingPostProcessingService(prisma, ai, gamification);
    jest.spyOn((service as any).pubRedis, 'publish').mockResolvedValue(1);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('1. Persists feedback after score completion without rescoring or calling Azure', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 1,
      userId: 2,
      status: 'COMPLETED',
      feedbackStatus: 'PENDING',
      overallScore: 8,
      aiFeedback: { overallScore: 8, fluencyScore: 85 },
      exercise: { targetText: 'Hello world' },
    });

    await service.processFeedback(1, 'trace-1', 1, 4);

    expect(ai.generatePronunciationFeedback).toHaveBeenCalledWith(
      'Hello world',
      expect.objectContaining({ overallScore: 8, fluencyScore: 85 }),
    );
    expect(ai.assessPronunciation).not.toHaveBeenCalled();
    expect(prisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feedbackStatus: 'COMPLETED',
          feedbackError: null,
        }),
      }),
    );
  });

  it('2. Delayed Gemini does not delay score completion (score is already COMPLETED in DB)', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 10,
      userId: 2,
      status: 'COMPLETED',
      feedbackStatus: 'PENDING',
      overallScore: 9,
      aiFeedback: { overallScore: 9 },
      exercise: { targetText: 'Delayed text' },
    });

    ai.generatePronunciationFeedback.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { feedback: 'Delayed feedback' };
    });

    await service.processFeedback(10, 'trace-delayed', 1, 4);

    expect(ai.assessPronunciation).not.toHaveBeenCalled();
    expect(prisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feedbackStatus: 'COMPLETED',
        }),
      }),
    );
  });

  it('3. Gemini terminal failure preserves score and sets feedbackStatus=FAILED', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 20,
      userId: 2,
      status: 'COMPLETED',
      feedbackStatus: 'PROCESSING',
      overallScore: 7.5,
      aiFeedback: { overallScore: 7.5 },
      exercise: { targetText: 'Fail text' },
    });

    ai.generatePronunciationFeedback.mockRejectedValue(
      new Error('Gemini quota exceeded 429'),
    );

    // attempt 4 of 4 (terminal)
    await service.processFeedback(20, 'trace-fail', 4, 4);

    expect(ai.assessPronunciation).not.toHaveBeenCalled();
    expect(prisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feedbackStatus: 'FAILED',
          feedbackError: expect.stringContaining('Gemini quota exceeded 429'),
        }),
      }),
    );
  });

  it('4. Stale feedback worker cannot overwrite replacement result (token fencing)', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 30,
      userId: 2,
      status: 'COMPLETED',
      feedbackStatus: 'PENDING',
      overallScore: 8,
      aiFeedback: { overallScore: 8 },
      exercise: { targetText: 'Stale text' },
    });

    // Claim succeeds (1) but persist fails (0) because lease was stolen by another worker
    prisma.speakingSubmission.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }); // persist with stale token

    await service.processFeedback(30, 'trace-stale', 1, 4);

    // Should not publish completed event if persist count was 0
    expect((service as any).pubRedis.publish).not.toHaveBeenCalled();
  });

  it('5. Stale reward worker cannot finalize replacement state (token fencing)', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 40,
      userId: 3,
      status: 'COMPLETED',
      rewardStatus: 'PENDING',
      rewardGrantedAt: null,
      overallScore: 8.5,
    });

    // Claim succeeds (1) but persist fails (0) because another worker finalized it
    prisma.speakingSubmission.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }); // persist with stale token

    await service.processReward(40, 'trace-stale-rw', 1, 4);

    expect((service as any).pubRedis.publish).not.toHaveBeenCalled();
  });

  it('6. Duplicate feedback job does not alter score or regenerate feedback', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 50,
      status: 'COMPLETED',
      feedbackStatus: 'COMPLETED',
      overallScore: 9.0,
    });

    await service.processFeedback(50, 'trace-dup-fb', 1, 4);

    expect(ai.generatePronunciationFeedback).not.toHaveBeenCalled();
    expect(prisma.speakingSubmission.updateMany).not.toHaveBeenCalled();
  });

  it('7. Duplicate reward job does not duplicate side effects', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 60,
      status: 'COMPLETED',
      rewardStatus: 'COMPLETED',
      rewardGrantedAt: new Date(),
      overallScore: 9.0,
    });

    await service.processReward(60, 'trace-dup-rw', 1, 4);

    expect(gamification.handleSpeakingSubmittedEvent).not.toHaveBeenCalled();
    expect(prisma.speakingSubmission.updateMany).not.toHaveBeenCalled();
  });

  it('8. Post-processing recovery never calls Azure pronunciation assessment', async () => {
    prisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 70,
      userId: 5,
      exerciseId: 1,
      status: 'COMPLETED',
      rewardStatus: 'PENDING',
      rewardGrantedAt: null,
      overallScore: 8.0,
    });

    await service.processReward(70, 'trace-recover-rw', 1, 4);

    expect(ai.assessPronunciation).not.toHaveBeenCalled();
    expect(gamification.handleSpeakingSubmittedEvent).toHaveBeenCalled();
  });
});
