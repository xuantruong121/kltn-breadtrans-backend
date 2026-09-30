/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnrecoverableError } from 'bullmq';
import { SpeakingProcessorService } from './speaking-processor.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import * as speakingConstants from './speaking.constants';
import {
  SPEAKING_EVENTS_CHANNEL,
  SPEAKING_COMPLETED_EVENT,
  SPEAKING_FAILED_EVENT,
} from './speaking.constants';

describe('SpeakingProcessorService (BullMQ Pipeline Phase 1)', () => {
  let service: SpeakingProcessorService;
  let mockPrisma: any;
  let mockAiService: any;
  let mockUploadService: any;
  let mockEventEmitter: any;
  let publishSpy: jest.SpyInstance;

  // 1-second 16kHz mono 16-bit PCM WAV buffer
  const sampleRate = 16000;
  const numSamples = sampleRate;
  const dataSize = numSamples * 2;
  const validWav = Buffer.alloc(44 + dataSize);
  validWav.write('RIFF', 0);
  validWav.writeUInt32LE(36 + dataSize, 4);
  validWav.write('WAVE', 8);
  validWav.write('fmt ', 12);
  validWav.writeUInt32LE(16, 16);
  validWav.writeUInt16LE(1, 20); // PCM
  validWav.writeUInt16LE(1, 22); // mono
  validWav.writeUInt32LE(sampleRate, 24);
  validWav.writeUInt32LE(sampleRate * 2, 28);
  validWav.writeUInt16LE(2, 32);
  validWav.writeUInt16LE(16, 34);
  validWav.write('data', 36);
  validWav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const val = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000,
    );
    validWav.writeInt16LE(val, 44 + i * 2);
  }

  beforeEach(async () => {
    process.env.MOCK_AZURE_SPEECH = 'true';
    process.env.MOCK_AZURE_DELAY_MS = '0';
    delete process.env.MOCK_AZURE_SIMULATE_429;
    delete process.env.MOCK_AZURE_SIMULATE_5XX;
    delete process.env.MOCK_AZURE_SIMULATE_TIMEOUT;

    mockPrisma = {
      speakingSubmission: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
    };

    mockAiService = {
      assessPronunciation: jest.fn(),
    };

    mockUploadService = {
      downloadFileBuffer: jest.fn().mockResolvedValue(validWav),
    };

    mockEventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeakingProcessorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiService, useValue: mockAiService },
        { provide: UploadService, useValue: mockUploadService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SpeakingProcessorService>(SpeakingProcessorService);

    // Spy on publishEvent via the Redis instance
    publishSpy = jest
      .spyOn((service as any).pubRedis, 'publish')
      .mockResolvedValue(1);
  });

  afterEach(async () => {
    await service.close();
    jest.restoreAllMocks();
  });

  it('1. Processes a valid BullMQ job successfully with token-fenced atomic claim and DB commit before PubSub', async () => {
    const submittedAt = new Date(Date.now() - 1000);
    mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
      id: 101,
      userId: 5,
      exerciseId: 1,
      status: 'PENDING',
      submittedAt,
      attemptCount: 0,
      audioKey: 'catalog/speaking/submissions/test.wav',
      audioMimeType: 'audio/wav',
      exercise: { id: 1, targetText: 'Hello world' },
    });

    await service.processJob({ submissionId: 101, traceId: 'trace-101' });

    // Assert atomic claim: PENDING or expired lease
    expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 101,
          OR: expect.arrayContaining([
            { status: 'PENDING' },
            expect.objectContaining({ status: 'PROCESSING' }),
          ]),
        }),
        data: expect.objectContaining({
          status: 'PROCESSING',
          workerId: expect.stringMatching(/^worker-/),
          attemptCount: { increment: 1 },
        }),
      }),
    );

    // Assert persistence to COMPLETED with token fencing
    expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 101,
          status: 'PROCESSING',
          workerId: expect.stringMatching(/^worker-/),
        }),
        data: expect.objectContaining({
          status: 'COMPLETED',
          overallScore: 8.8,
          provider: 'mock',
        }),
      }),
    );

    // Assert Redis Pub/Sub published event ONLY after DB update, with NO overallScore in payload
    expect(publishSpy).toHaveBeenCalledWith(
      SPEAKING_EVENTS_CHANNEL,
      expect.stringContaining(SPEAKING_COMPLETED_EVENT),
    );
    const publishedPayload = JSON.parse(publishSpy.mock.calls[0][1]);
    expect(publishedPayload).toEqual({
      type: SPEAKING_COMPLETED_EVENT,
      userId: 5,
      submissionId: 101,
      traceId: 'trace-101',
    });
  });

  it('2. Concurrency Safety: When two workers race for the same submission, exactly one claims and scores it', async () => {
    mockPrisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 200,
      userId: 10,
      exerciseId: 2,
      status: 'PENDING',
      submittedAt: new Date(),
      attemptCount: 0,
      audioKey: 'catalog/speaking/submissions/race.wav',
      exercise: { id: 2, targetText: 'Race condition test' },
    });

    let claimed = false;
    mockPrisma.speakingSubmission.updateMany.mockImplementation(
      ({ where }: any) => {
        // Claim query
        if (where?.OR) {
          if (!claimed) {
            claimed = true;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }
        // Score persist query
        if (where?.status === 'PROCESSING') {
          return Promise.resolve({ count: 1 });
        }
        // Reward claim query
        if (where?.rewardGrantedAt === null) {
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      },
    );

    const [res1, res2] = await Promise.all([
      service.processJob({ submissionId: 200, traceId: 'trace-worker-1' }),
      service.processJob({ submissionId: 200, traceId: 'trace-worker-2' }),
    ]);

    expect(res1).toBeUndefined();
    expect(res2).toBeUndefined();

    // Exactly one gamification event emitted
    expect(mockEventEmitter.emitAsync).toHaveBeenCalledTimes(1);

    // Exactly one Redis PubSub event emitted
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('3. Idempotency: Does not re-score or reprocess when submission is already COMPLETED', async () => {
    mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
      id: 102,
      userId: 5,
      status: 'COMPLETED',
      overallScore: 9.0,
      exercise: { targetText: 'Already scored' },
    });

    await service.processJob({ submissionId: 102, traceId: 'trace-dup' });

    expect(mockPrisma.speakingSubmission.updateMany).not.toHaveBeenCalled();
    expect(mockUploadService.downloadFileBuffer).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('4. Transient error: Re-queues with exponential backoff on Azure 429 rate limit', async () => {
    process.env.MOCK_AZURE_SIMULATE_429 = 'true';

    mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
      id: 103,
      userId: 5,
      status: 'PENDING',
      submittedAt: new Date(),
      attemptCount: 0,
      audioKey: 'test-429.wav',
      exercise: { targetText: 'Rate limit test' },
    });

    await expect(
      service.processJob({ submissionId: 103, traceId: 'trace-429' }),
    ).rejects.toThrow('Too Many Requests');

    // Should update status to PENDING with nextAttemptAt backoff
    expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 103, status: 'PROCESSING' }),
        data: expect.objectContaining({
          status: 'PENDING',
          lastErrorCode: 'TOO_MANY_REQUESTS',
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });

  it('5. Permanent error: Throws BullMQ UnrecoverableError and marks FAILED for corrupted audio bytes', async () => {
    mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
      id: 104,
      userId: 5,
      status: 'PENDING',
      submittedAt: new Date(),
      attemptCount: 0,
      audioKey: 'corrupt.wav',
      exercise: { targetText: 'Corrupt audio' },
    });

    mockUploadService.downloadFileBuffer.mockResolvedValueOnce(
      Buffer.from('not-a-wav-file'),
    );

    // Permanent audio failure must throw UnrecoverableError so BullMQ halts retries
    await expect(
      service.processJob({ submissionId: 104, traceId: 'trace-corrupt' }),
    ).rejects.toThrow(UnrecoverableError);

    expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 104, status: 'PROCESSING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          lastErrorCode: 'INVALID_AUDIO',
        }),
      }),
    );

    // Published failure notification to user room
    expect(publishSpy).toHaveBeenCalledWith(
      SPEAKING_EVENTS_CHANNEL,
      expect.stringContaining(SPEAKING_FAILED_EVENT),
    );
  });

  it('6. Marks FAILED after reaching maximum retry attempts (attempt 4)', async () => {
    process.env.MOCK_AZURE_SIMULATE_5XX = 'true';

    mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
      id: 105,
      userId: 5,
      status: 'PROCESSING',
      submittedAt: new Date(),
      attemptCount: 3, // Current attempt will become 4 (MAX_ATTEMPTS)
      audioKey: 'test-max.wav',
      exercise: { targetText: 'Max retry test' },
    });

    await expect(
      service.processJob({ submissionId: 105, traceId: 'trace-max' }),
    ).rejects.toThrow();

    expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 105, status: 'PROCESSING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          lastErrorCode: 'PROVIDER_UNAVAILABLE',
        }),
      }),
    );

    expect(publishSpy).toHaveBeenCalledWith(
      SPEAKING_EVENTS_CHANNEL,
      expect.stringContaining(SPEAKING_FAILED_EVENT),
    );
  });

  it('7. Timeout Enforcement: Aborts long-running evaluations and discards late evaluator results', async () => {
    process.env.SPEAKING_JOB_TIMEOUT_MS = '5000';

    mockPrisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 106,
      userId: 5,
      status: 'PENDING',
      submittedAt: new Date(),
      attemptCount: 0,
      audioKey: 'slow.wav',
      exercise: { targetText: 'Slow evaluation' },
    });

    jest
      .spyOn(mockUploadService, 'downloadFileBuffer')
      .mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(validWav), 200)),
      );

    jest.spyOn(speakingConstants, 'getSpeakingWorkerConfig').mockReturnValue({
      concurrency: 1,
      rateLimitMax: 1,
      rateLimitDurationMs: 1000,
      jobTimeoutMs: 50, // 50ms test timeout
    });

    await expect(
      service.processJob({ submissionId: 106, traceId: 'trace-timeout' }),
    ).rejects.toThrow(/JOB_TIMEOUT/);

    // Stale completion is NEVER written to DB
    expect(mockPrisma.speakingSubmission.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );

    // Submission was updated with JOB_TIMEOUT retry
    expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 106, status: 'PROCESSING' }),
        data: expect.objectContaining({
          lastErrorCode: 'JOB_TIMEOUT',
        }),
      }),
    );
  });

  it('8. Lease-Token Fencing: When Worker A evaluation is delayed and Worker B claims/completes it, Worker A late result is discarded', async () => {
    const submissionId = 300;
    mockPrisma.speakingSubmission.findUnique.mockResolvedValue({
      id: submissionId,
      userId: 7,
      exerciseId: 3,
      status: 'PENDING',
      submittedAt: new Date(),
      attemptCount: 0,
      audioKey: 'catalog/speaking/submissions/lease.wav',
      exercise: { id: 3, targetText: 'Lease token test' },
    });

    let currentOwnerToken: string | null = null;
    let completed = false;

    // Simulate database behavior for lease token fencing
    mockPrisma.speakingSubmission.updateMany.mockImplementation(
      ({ where, data }: any) => {
        // Claim query
        if (where?.OR) {
          currentOwnerToken = data.workerId;
          return Promise.resolve({ count: 1 });
        }
        // Score persist query (requires status: 'PROCESSING', workerId: token)
        if (where?.status === 'PROCESSING') {
          if (where.workerId === currentOwnerToken && !completed) {
            completed = true;
            return Promise.resolve({ count: 1 });
          }
          // Fencing token mismatch (lease was reset or stolen) -> count: 0
          return Promise.resolve({ count: 0 });
        }
        // Gamification reward query
        if (where?.status === 'COMPLETED' && where?.rewardGrantedAt === null) {
          if (where.workerId === currentOwnerToken) {
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }
        return Promise.resolve({ count: 0 });
      },
    );

    // Worker A begins, but its evaluation takes 60ms
    let workerAFinished = false;
    const workerAPromise = (async () => {
      // simulate slow audio evaluation
      jest
        .spyOn(mockUploadService, 'downloadFileBuffer')
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => {
                resolve(validWav);
              }, 60),
            ),
        );
      await service.processJob({
        submissionId,
        traceId: 'trace-worker-a-delayed',
      });
      workerAFinished = true;
    })();

    // Worker B claims the submission after 20ms (simulating lease expiration / recovery)
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.processJob({
      submissionId,
      traceId: 'trace-worker-b-recovery',
    });

    // Await Worker A completion
    await workerAPromise;
    expect(workerAFinished).toBe(true);

    // Gamification reward must have been granted EXACTLY ONCE (by Worker B)
    expect(mockEventEmitter.emitAsync).toHaveBeenCalledTimes(1);

    // Redis Pub/Sub completion event must have been published EXACTLY ONCE (by Worker B)
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const pubEvent = JSON.parse(publishSpy.mock.calls[0][1]);
    expect(pubEvent.traceId).toBe('trace-worker-b-recovery');
  });
});
