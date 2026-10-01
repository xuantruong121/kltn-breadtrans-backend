import { EventEmitter2 } from '@nestjs/event-emitter';
import IORedis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { GamificationListener } from '../gamification/gamification.listener';
import { SpeakingPostProcessingService } from './speaking-post-processing.service';
import { SpeakingProcessorService } from './speaking-processor.service';
import { SpeakingWorkerService } from './speaking-worker.service';
import { SpeakingEventPublisherService } from './speaking-event-publisher.service';
import { SpeakingWorkerRunnerService } from '../../worker/speaking-worker-runner.service';
import { AiService } from '../ai/ai.service';
import { createWavBuffer } from './speaking-audio-validator';
import { SPEAKING_COMPLETED_EVENT } from './speaking.constants';

describe('Speaking Reward Atomicity & Event Parity (Phase S2A Integration)', () => {
  let prisma: PrismaService;
  let gamificationService: GamificationService;
  let gamificationListener: GamificationListener;
  let postProcessingService: SpeakingPostProcessingService;
  let eventPublisher: SpeakingEventPublisherService;
  let redisConnection: IORedis;
  let eventEmitter: EventEmitter2;

  let testUserId: number;
  let testExerciseId: number;

  beforeAll(async () => {
    prisma = new PrismaService();
    eventEmitter = new EventEmitter2();
    redisConnection = new IORedis(
      process.env.REDIS_URL || 'redis://localhost:6379',
      {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    );

    gamificationService = new GamificationService(
      prisma,
      eventEmitter,
      redisConnection,
    );
    gamificationListener = new GamificationListener(
      prisma,
      gamificationService,
      eventEmitter,
    );
    eventPublisher = new SpeakingEventPublisherService();

    const mockAiService: Partial<AiService> = {
      generatePronunciationFeedback: jest.fn().mockResolvedValue({}),
      assessPronunciation: jest.fn().mockResolvedValue({
        overallScore: 85,
        transcript: 'Practice speaking English accurately.',
        isSilentOrNoSpeech: false,
      }),
    };

    postProcessingService = new SpeakingPostProcessingService(
      prisma,
      mockAiService as AiService,
      gamificationListener,
    );

    // Suppress redis publish spam during unit tests
    jest
      .spyOn((postProcessingService as any).pubRedis, 'publish')
      .mockResolvedValue(1);

    // Setup base disposable user
    const testUser = await prisma.user.create({
      data: {
        email: `test_s2a_${Date.now()}@breadtrans.local`,
        role: 'STUDENT',
      },
    });
    testUserId = testUser.id;

    // Setup base disposable exercise
    const exercise = await prisma.speakingExercise.create({
      data: {
        title: 'S2A Verification Exercise',
        targetText: 'Practice speaking English accurately.',
        category: 'GENERAL',
      },
    });
    testExerciseId = exercise.id;

    // Ensure DO_SPEAKING quest exists
    let q1 = await prisma.dailyQuest.findFirst({
      where: { type: 'DO_SPEAKING' },
    });
    if (!q1) {
      q1 = await prisma.dailyQuest.create({
        data: {
          title: 'Luyện nói câu',
          type: 'DO_SPEAKING',
          targetValue: 5,
          rewardXP: 20,
          rewardBanh: 10,
          isActive: true,
        },
      });
    }

    // Ensure PRACTICE_SPEAKING quest exists
    let q2 = await prisma.dailyQuest.findFirst({
      where: { type: 'PRACTICE_SPEAKING' },
    });
    if (!q2) {
      q2 = await prisma.dailyQuest.create({
        data: {
          title: 'Thực hành phát âm',
          type: 'PRACTICE_SPEAKING',
          targetValue: 5,
          rewardXP: 25,
          rewardBanh: 15,
          isActive: true,
        },
      });
    }
  });

  afterAll(async () => {
    try {
      if (testUserId) {
        await prisma.user.delete({ where: { id: testUserId } });
      }
      if (testExerciseId) {
        await prisma.speakingExercise.delete({
          where: { id: testExerciseId },
        });
      }
    } catch {
      // ignore cleanup errors
    }
    if (postProcessingService) {
      await postProcessingService.onModuleDestroy();
    }
    if (eventPublisher) {
      await eventPublisher.onModuleDestroy();
    }
    if (redisConnection) {
      await redisConnection.quit();
    }
    await prisma.$disconnect();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper to create disposable completed submission for reward testing (1-7)
  async function createRewardSubmission(score = 85): Promise<number> {
    const sub = await prisma.speakingSubmission.create({
      data: {
        userId: testUserId,
        exerciseId: testExerciseId,
        status: 'COMPLETED',
        overallScore: score,
        transcript: 'Practice speaking English accurately.',
        feedbackStatus: 'NOT_REQUESTED',
        rewardStatus: 'PENDING',
        rewardGrantedAt: null,
        audioKey: 'speaking/test/dummy.wav',
      },
    });
    return sub.id;
  }

  // Helper to create disposable pending submission for scoring testing (8-10)
  async function createPendingSubmission(): Promise<number> {
    const sub = await prisma.speakingSubmission.create({
      data: {
        userId: testUserId,
        exerciseId: testExerciseId,
        status: 'PENDING',
        overallScore: null,
        transcript: null,
        feedbackStatus: 'NOT_REQUESTED',
        rewardStatus: 'NOT_REQUESTED',
        rewardGrantedAt: null,
        audioKey: 'speaking/test/dummy.wav',
      },
    });
    return sub.id;
  }

  // 1. Crash after XP ledger insert but before XP mutation
  it('1. Crash after XP ledger insert but before XP mutation: transaction rolls back and retry grants XP exactly once', async () => {
    const subId = await createRewardSubmission(85);
    const xpReason = `Hoàn thành bài luyện nói #${subId}`;

    // Crash during awardXp mutation
    const awardXpSpy = jest
      .spyOn(gamificationService, 'awardXp')
      .mockRejectedValueOnce(new Error('FORCED_XP_MUTATION_CRASH'));

    await expect(
      postProcessingService.processReward(subId, 'trace-crash-xp', 1, 4),
    ).rejects.toThrow('FORCED_XP_MUTATION_CRASH');

    // Verify rollback: ledger row and point history must NOT exist
    const rolledBackLedger = await prisma.speakingRewardLedger.findFirst({
      where: { submissionId: subId, rewardType: 'XP' },
    });
    expect(rolledBackLedger).toBeNull();

    const rolledBackHistory = await prisma.pointHistory.findFirst({
      where: { userId: testUserId, reason: xpReason },
    });
    expect(rolledBackHistory).toBeNull();

    // Verify submission is still retryable
    const subAfterCrash = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(subAfterCrash?.rewardStatus).toBe('PENDING');

    // Retry without crash
    awardXpSpy.mockRestore();
    await postProcessingService.processReward(subId, 'trace-retry-xp', 2, 4);

    // Verify exactly once after retry
    const finalLedger = await prisma.speakingRewardLedger.findMany({
      where: { submissionId: subId, rewardType: 'XP' },
    });
    expect(finalLedger.length).toBe(1);

    const finalHistory = await prisma.pointHistory.findMany({
      where: { userId: testUserId, reason: xpReason },
    });
    expect(finalHistory.length).toBe(1);
  });

  // 2. Crash after Bánh Mì ledger insert but before balance mutation
  it('2. Crash after Bánh Mì ledger insert but before balance mutation: transaction rolls back and retry grants Bánh Mì exactly once', async () => {
    const subId = await createRewardSubmission(85);
    const banhRef = `speaking:submission:${subId}`;

    const awardBanhSpy = jest
      .spyOn(gamificationService, 'awardSpeakingReward')
      .mockRejectedValueOnce(new Error('FORCED_BANH_MUTATION_CRASH'));

    await expect(
      postProcessingService.processReward(subId, 'trace-crash-banh', 1, 4),
    ).rejects.toThrow('FORCED_BANH_MUTATION_CRASH');

    // Verify rollback
    const rolledBackLedger = await prisma.speakingRewardLedger.findFirst({
      where: { submissionId: subId, rewardType: 'BANH' },
    });
    expect(rolledBackLedger).toBeNull();

    const rolledBackBanhTx = await prisma.banhTransaction.findFirst({
      where: { userId: testUserId, reference: banhRef },
    });
    expect(rolledBackBanhTx).toBeNull();

    // Retry
    awardBanhSpy.mockRestore();
    await postProcessingService.processReward(subId, 'trace-retry-banh', 2, 4);

    // Verify exactly once
    const finalLedger = await prisma.speakingRewardLedger.findMany({
      where: { submissionId: subId, rewardType: 'BANH' },
    });
    expect(finalLedger.length).toBe(1);

    const finalBanhTx = await prisma.banhTransaction.findMany({
      where: { userId: testUserId, reference: banhRef },
    });
    expect(finalBanhTx.length).toBe(1);
  });

  // 3. Crash during Daily Quest processing
  it('3. Crash during Daily Quest processing: completed quest remains committed, missing resumes on retry, no double progression', async () => {
    // Create dedicated user so quest progress is uncompleted today
    const user3 = await prisma.user.create({
      data: {
        email: `test_q_${Date.now()}@breadtrans.local`,
        role: 'STUDENT',
      },
    });
    const sub = await prisma.speakingSubmission.create({
      data: {
        userId: user3.id,
        exerciseId: testExerciseId,
        status: 'COMPLETED',
        overallScore: 85,
        transcript: 'Practice speaking English accurately.',
        feedbackStatus: 'NOT_REQUESTED',
        rewardStatus: 'PENDING',
        rewardGrantedAt: null,
        audioKey: 'speaking/test/dummy.wav',
      },
    });
    const subId = sub.id;

    // Order of quests in execution
    const activeQuests = await prisma.dailyQuest.findMany({
      where: {
        isActive: true,
        type: { in: ['DO_SPEAKING', 'PRACTICE_SPEAKING'] },
      },
      orderBy: { id: 'asc' },
    });
    const firstQuest = activeQuests[0];
    const secondQuest = activeQuests[1];

    // Spy to fail on the second quest in the loop
    const originalAdvance =
      gamificationService.advanceDailyQuestAndGrantRewardsTx.bind(
        gamificationService,
      );
    const questSpy = jest
      .spyOn(gamificationService, 'advanceDailyQuestAndGrantRewardsTx')
      .mockImplementation(async (userId, quest, count, today, tx) => {
        if (quest.id === secondQuest.id) {
          throw new Error('FORCED_QUEST_2_CRASH');
        }
        return originalAdvance(userId, quest, count, today, tx);
      });

    await expect(
      postProcessingService.processReward(subId, 'trace-crash-quest', 1, 4),
    ).rejects.toThrow('FORCED_QUEST_2_CRASH');

    // First quest committed
    const q1Ledger = await prisma.speakingRewardLedger.findFirst({
      where: {
        submissionId: subId,
        rewardType: 'QUEST',
        reference: `quest:${firstQuest.id}:speaking:${subId}`,
      },
    });
    expect(q1Ledger).not.toBeNull();

    // Second quest rolled back
    const q2Ledger = await prisma.speakingRewardLedger.findFirst({
      where: {
        submissionId: subId,
        rewardType: 'QUEST',
        reference: `quest:${secondQuest.id}:speaking:${subId}`,
      },
    });
    expect(q2Ledger).toBeNull();

    // Reward status must not be completed
    const subMid = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(subMid?.rewardStatus).toBe('PENDING');

    // Retry
    questSpy.mockRestore();
    await postProcessingService.processReward(subId, 'trace-retry-quest', 2, 4);

    // Both quests now committed exactly once
    const finalQ1 = await prisma.speakingRewardLedger.findMany({
      where: {
        submissionId: subId,
        rewardType: 'QUEST',
        reference: `quest:${firstQuest.id}:speaking:${subId}`,
      },
    });
    expect(finalQ1.length).toBe(1);

    const finalQ2 = await prisma.speakingRewardLedger.findMany({
      where: {
        submissionId: subId,
        rewardType: 'QUEST',
        reference: `quest:${secondQuest.id}:speaking:${subId}`,
      },
    });
    expect(finalQ2.length).toBe(1);

    const subFinal = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(subFinal?.rewardStatus).toBe('COMPLETED');

    await prisma.user.delete({ where: { id: user3.id } });
  });

  // 4. Crash during Badge processing
  it('4. Crash during Badge processing: eligible badge is not lost and badge is not duplicated', async () => {
    // Create dedicated user without existing badges
    const user = await prisma.user.create({
      data: {
        email: `badge_test_${Date.now()}@breadtrans.local`,
        role: 'STUDENT',
      },
    });
    const sub = await prisma.speakingSubmission.create({
      data: {
        userId: user.id,
        exerciseId: testExerciseId,
        status: 'COMPLETED',
        overallScore: 90,
        transcript: 'Test speech',
        feedbackStatus: 'NOT_REQUESTED',
        rewardStatus: 'PENDING',
        audioKey: 'speaking/test/dummy.wav',
      },
    });

    const badgeSpy = jest
      .spyOn(gamificationService, 'awardBadgeIfEarned')
      .mockRejectedValueOnce(new Error('FORCED_BADGE_CRASH'));

    await expect(
      postProcessingService.processReward(sub.id, 'trace-crash-badge', 1, 4),
    ).rejects.toThrow('FORCED_BADGE_CRASH');

    // Verify rollback
    const rolledBackBadgeLedger = await prisma.speakingRewardLedger.findFirst({
      where: { submissionId: sub.id, rewardType: 'BADGE' },
    });
    expect(rolledBackBadgeLedger).toBeNull();

    const rolledBackUserBadge = await prisma.userBadge.findFirst({
      where: { userId: user.id },
    });
    expect(rolledBackUserBadge).toBeNull();

    // Retry
    badgeSpy.mockRestore();
    await postProcessingService.processReward(
      sub.id,
      'trace-retry-badge',
      2,
      4,
    );

    const finalBadgeLedger = await prisma.speakingRewardLedger.findMany({
      where: { submissionId: sub.id, rewardType: 'BADGE' },
    });
    expect(finalBadgeLedger.length).toBe(1);

    const finalUserBadges = await prisma.userBadge.findMany({
      where: { userId: user.id },
    });
    expect(finalUserBadges.length).toBe(1);

    // Another retry must NOT duplicate badge
    await postProcessingService.processReward(
      sub.id,
      'trace-retry-badge-2',
      3,
      4,
    );
    const recheckUserBadges = await prisma.userBadge.findMany({
      where: { userId: user.id },
    });
    expect(recheckUserBadges.length).toBe(1);

    await prisma.user.delete({ where: { id: user.id } });
  });

  // 5. Crash after one logical reward commits but before the next begins
  it('5. Crash after one logical reward commits but before the next begins: retry resumes only missing reward effects', async () => {
    const subId = await createRewardSubmission(85);

    // XP succeeds, BANH fails
    const banhSpy = jest
      .spyOn(gamificationService, 'awardSpeakingReward')
      .mockRejectedValueOnce(new Error('CRASH_BETWEEN_REWARDS'));

    await expect(
      postProcessingService.processReward(subId, 'trace-between-crash', 1, 4),
    ).rejects.toThrow('CRASH_BETWEEN_REWARDS');

    // XP is committed
    const xpLedger = await prisma.speakingRewardLedger.findFirst({
      where: { submissionId: subId, rewardType: 'XP' },
    });
    expect(xpLedger).not.toBeNull();

    // BANH is missing
    const banhLedger = await prisma.speakingRewardLedger.findFirst({
      where: { submissionId: subId, rewardType: 'BANH' },
    });
    expect(banhLedger).toBeNull();

    // Retry resumes and completes missing effects
    banhSpy.mockRestore();
    await postProcessingService.processReward(
      subId,
      'trace-between-retry',
      2,
      4,
    );

    const finalXpLedger = await prisma.speakingRewardLedger.findMany({
      where: { submissionId: subId, rewardType: 'XP' },
    });
    expect(finalXpLedger.length).toBe(1);

    const finalBanhLedger = await prisma.speakingRewardLedger.findMany({
      where: { submissionId: subId, rewardType: 'BANH' },
    });
    expect(finalBanhLedger.length).toBe(1);
  });

  // 6. Concurrent duplicate reward jobs
  it('6. Concurrent duplicate reward jobs: every eligible logical effect occurs exactly once', async () => {
    const subId = await createRewardSubmission(85);

    // Run 2 workers racing concurrently for the same submission
    await Promise.all([
      postProcessingService.processReward(subId, 'trace-concurrent-A', 1, 4),
      postProcessingService.processReward(subId, 'trace-concurrent-B', 1, 4),
    ]);

    const xpLedgers = await prisma.speakingRewardLedger.findMany({
      where: { submissionId: subId, rewardType: 'XP' },
    });
    expect(xpLedgers.length).toBe(1);

    const banhLedgers = await prisma.speakingRewardLedger.findMany({
      where: { submissionId: subId, rewardType: 'BANH' },
    });
    expect(banhLedgers.length).toBe(1);

    const finalSub = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(finalSub?.rewardStatus).toBe('COMPLETED');
  });

  // 7. rewardStatus is not marked COMPLETED while an eligible effect is missing
  it('7. rewardStatus is not marked COMPLETED while an eligible effect is missing', async () => {
    const subId = await createRewardSubmission(85);

    jest
      .spyOn(gamificationService, 'awardSpeakingReward')
      .mockRejectedValueOnce(new Error('TRANSIENT_FAILURE'));

    await expect(
      postProcessingService.processReward(subId, 'trace-incomplete', 1, 4),
    ).rejects.toThrow();

    const sub = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(sub?.rewardStatus).toBe('PENDING');
    expect(sub?.rewardGrantedAt).toBeNull();
  });

  // 8. BullMQ score processor publishes one completion event after commit
  it('8. BullMQ score processor publishes one completion event after commit with minimal payload', async () => {
    const subId = await createPendingSubmission();
    const mockUploadService = {
      downloadFileBuffer: jest
        .fn()
        .mockResolvedValue(createWavBuffer({ durationSeconds: 1 })),
    };
    const mockAiService = {
      assessPronunciation: jest.fn().mockResolvedValue({
        overallScore: 88,
        transcript: 'Hello test speech',
        isSilentOrNoSpeech: false,
      }),
    };

    const pubSpy = jest
      .spyOn(eventPublisher, 'publishEvent')
      .mockResolvedValue();

    const processor = new SpeakingProcessorService(
      prisma,
      mockAiService as any,
      mockUploadService as any,
      eventEmitter,
      undefined,
      postProcessingService,
      eventPublisher,
    );

    await processor.processJob({
      submissionId: subId,
      traceId: 'trace-bullmq-event-8',
    });

    // Verify DB committed before or at publish
    const committed = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(committed?.status).toBe('COMPLETED');
    expect(Number(committed?.overallScore)).toBeCloseTo(8.8, 1);

    // Verify exactly one event published with minimal payload
    expect(pubSpy).toHaveBeenCalledTimes(1);
    expect(pubSpy).toHaveBeenCalledWith({
      type: SPEAKING_COMPLETED_EVENT,
      userId: testUserId,
      submissionId: subId,
      traceId: 'trace-bullmq-event-8',
    });

    await processor.close();
  });

  // 9. Legacy score worker publishes one completion event after commit
  it('9. Legacy score worker publishes one completion event after commit', async () => {
    const subId = await createPendingSubmission();
    const mockUploadService = {
      downloadFileBuffer: jest
        .fn()
        .mockResolvedValue(createWavBuffer({ durationSeconds: 1 })),
    };
    const mockAiService = {
      assessPronunciation: jest.fn().mockResolvedValue({
        overallScore: 82,
        transcript: 'Hello legacy speech',
        isSilentOrNoSpeech: false,
      }),
    };

    const pubSpy = jest
      .spyOn(eventPublisher, 'publishEvent')
      .mockResolvedValue();

    const worker = new SpeakingWorkerService(
      prisma,
      mockAiService as any,
      mockUploadService as any,
      eventEmitter,
      undefined,
      eventPublisher,
    );

    await worker.processSubmission(subId);

    const committed = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(committed?.status).toBe('COMPLETED');
    expect(committed?.overallScore).toBe(82);

    expect(pubSpy).toHaveBeenCalledTimes(1);
    expect(pubSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SPEAKING_COMPLETED_EVENT,
        userId: testUserId,
        submissionId: subId,
        traceId: expect.stringContaining(`legacy-${subId}-`),
      }),
    );
  });

  // 10. Event publication failure: score remains COMPLETED, Azure/mock scoring is not repeated
  it('10. Event publication failure: score remains COMPLETED and Azure assessment is not repeated', async () => {
    const subId = await createPendingSubmission();
    const mockUploadService = {
      downloadFileBuffer: jest
        .fn()
        .mockResolvedValue(createWavBuffer({ durationSeconds: 1 })),
    };
    let assessmentCalls = 0;
    const mockAiService = {
      assessPronunciation: jest.fn().mockImplementation(() => {
        assessmentCalls++;
        return {
          overallScore: 75,
          transcript: 'Speech text',
          isSilentOrNoSpeech: false,
        };
      }),
    };

    // Simulate Redis Pub/Sub failure inside eventPublisher.pubRedis
    jest
      .spyOn(eventPublisher.pubRedis, 'publish')
      .mockRejectedValue(new Error('REDIS_PUB_UNAVAILABLE'));

    const worker = new SpeakingWorkerService(
      prisma,
      mockAiService as any,
      mockUploadService as any,
      eventEmitter,
      undefined,
      eventPublisher,
    );

    // Run worker: event fails internally, but method does NOT throw or fail score
    await worker.processSubmission(subId);

    const committed = await prisma.speakingSubmission.findUnique({
      where: { id: subId },
    });
    expect(committed?.status).toBe('COMPLETED');
    expect(committed?.overallScore).toBe(75);
    expect(assessmentCalls).toBe(1);

    // Polling another time does not re-score an already COMPLETED submission
    await worker.processSubmission(subId);
    expect(assessmentCalls).toBe(1);
  });

  // 11. BullMQ and legacy processing cannot both handle the same submission under one valid pipeline configuration
  it('11. BullMQ and legacy processing mutual exclusion under valid pipeline configurations', async () => {
    const origEnv = process.env.SPEAKING_PIPELINE_MODE;

    try {
      // Configuration A: BullMQ mode
      process.env.SPEAKING_PIPELINE_MODE = 'bullmq';

      const worker = new SpeakingWorkerService(
        prisma,
        {} as any,
        {} as any,
        eventEmitter,
        undefined,
        eventPublisher,
      );

      const findManySpy = jest.spyOn(prisma.speakingSubmission, 'findMany');
      await worker.pollAndProcess();
      // Legacy poller must immediately return without touching the database
      expect(findManySpy).not.toHaveBeenCalled();

      // Configuration B: Legacy mode
      process.env.SPEAKING_PIPELINE_MODE = 'legacy';

      const runner = new SpeakingWorkerRunnerService({} as any);
      // BullMQ standalone worker MUST refuse to start in legacy mode
      expect(() => runner.onModuleInit()).toThrow(
        'Standalone speaking worker requires SPEAKING_PIPELINE_MODE=bullmq',
      );
    } finally {
      process.env.SPEAKING_PIPELINE_MODE = origEnv;
    }
  });
});
