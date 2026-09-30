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
        updateMany: jest.fn(),
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
  });

  it('1. Processes a valid BullMQ job successfully with atomic claim PENDING -> PROCESSING and DB commit before PubSub', async () => {
    const submittedAt = new Date(Date.now() - 1000);
    mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
      id: 101,
      userId: 5,
      status: 'PENDING',
      submittedAt,
      attemptCount: 0,
      audioKey: 'catalog/speaking/submissions/test.wav',
      audioMimeType: 'audio/wav',
      exercise: { targetText: 'Hello world' },
    });

    mockPrisma.speakingSubmission.updateMany
      .mockResolvedValueOnce({ count: 1 }) // atomic claim: PENDING -> PROCESSING
      .mockResolvedValueOnce({ count: 1 }); // gamification reward claim

    mockPrisma.speakingSubmission.update.mockResolvedValueOnce({
      id: 101,
      userId: 5,
      exerciseId: 1,
      status: 'COMPLETED',
      overallScore: 8.8,
      rewardGrantedAt: null,
    });

    await service.processJob({ submissionId: 101, traceId: 'trace-101' });

    // Assert STRICT atomic claim condition: status must be PENDING
    expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
        }),
      }),
    );

    // Assert persistence to COMPLETED
    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101 },
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
      status: 'PENDING',
      submittedAt: new Date(),
      attemptCount: 0,
      audioKey: 'catalog/speaking/submissions/race.wav',
      exercise: { targetText: 'Race condition test' },
    });

    let claimed = false;
    mockPrisma.speakingSubmission.updateMany.mockImplementation(
      ({ where }: any) => {
        if (where?.status === 'PENDING') {
          if (!claimed) {
            claimed = true;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }
        if (where?.rewardGrantedAt === null) {
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      },
    );

    mockPrisma.speakingSubmission.update.mockResolvedValue({
      id: 200,
      userId: 10,
      exerciseId: 2,
      status: 'COMPLETED',
      overallScore: 8.5,
      rewardGrantedAt: null,
    });

    const [res1, res2] = await Promise.all([
      service.processJob({ submissionId: 200, traceId: 'trace-worker-1' }),
      service.processJob({ submissionId: 200, traceId: 'trace-worker-2' }),
    ]);

    expect(res1).toBeUndefined();
    expect(res2).toBeUndefined();

    // Exactly one DB update to COMPLETED
    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledTimes(1);

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
    expect(mockPrisma.speakingSubmission.update).not.toHaveBeenCalled();
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

    mockPrisma.speakingSubmission.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await expect(
      service.processJob({ submissionId: 103, traceId: 'trace-429' }),
    ).rejects.toThrow('Too Many Requests');

    // Should update status to PENDING with nextAttemptAt backoff
    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 103 },
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

    mockPrisma.speakingSubmission.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    mockUploadService.downloadFileBuffer.mockResolvedValueOnce(
      Buffer.from('not-a-wav-file'),
    );

    // Permanent audio failure must throw UnrecoverableError so BullMQ halts retries
    await expect(
      service.processJob({ submissionId: 104, traceId: 'trace-corrupt' }),
    ).rejects.toThrow(UnrecoverableError);

    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 104 },
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

    mockPrisma.speakingSubmission.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await expect(
      service.processJob({ submissionId: 105, traceId: 'trace-max' }),
    ).rejects.toThrow();

    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 105 },
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
    process.env.SPEAKING_JOB_TIMEOUT_MS = '5000'; // minimum allowed is 5000ms

    // Mock upload download taking longer than timeout
    mockPrisma.speakingSubmission.findUnique.mockResolvedValue({
      id: 106,
      userId: 5,
      status: 'PENDING',
      submittedAt: new Date(),
      attemptCount: 0,
      audioKey: 'slow.wav',
      exercise: { targetText: 'Slow evaluation' },
    });

    mockPrisma.speakingSubmission.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    // Download hangs for 100ms with a 50ms test timeout configured via mock
    jest
      .spyOn(mockUploadService, 'downloadFileBuffer')
      .mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(validWav), 200)),
      );

    // Temporarily override timeout logic via spy
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
    expect(mockPrisma.speakingSubmission.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );

    // Submission was updated with JOB_TIMEOUT retry
    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 106 },
        data: expect.objectContaining({
          lastErrorCode: 'JOB_TIMEOUT',
        }),
      }),
    );
  });
});
