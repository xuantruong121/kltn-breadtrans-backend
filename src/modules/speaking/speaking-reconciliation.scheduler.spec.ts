/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { SpeakingReconciliationScheduler } from './speaking-reconciliation.scheduler';
import { PrismaService } from '../../prisma/prisma.service';
import { SpeakingQueueService } from './speaking-queue.service';

describe('SpeakingReconciliationScheduler (BullMQ Job State Recovery)', () => {
  let scheduler: SpeakingReconciliationScheduler;
  let mockPrisma: any;
  let mockQueueService: any;
  let mockQueue: any;

  beforeEach(async () => {
    process.env.SPEAKING_PIPELINE_MODE = 'bullmq';

    mockQueue = {
      getJob: jest.fn(),
    };

    mockQueueService = {
      getQueue: jest.fn().mockReturnValue(mockQueue),
      enqueueSubmission: jest.fn().mockResolvedValue('job-123'),
    };

    mockPrisma = {
      speakingSubmission: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeakingReconciliationScheduler,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SpeakingQueueService, useValue: mockQueueService },
      ],
    }).compile();

    scheduler = module.get<SpeakingReconciliationScheduler>(
      SpeakingReconciliationScheduler,
    );
  });

  afterEach(() => {
    delete process.env.SPEAKING_PIPELINE_MODE;
  });

  it('1. Skips enqueue when BullMQ job is waiting, active, or delayed (lifecycle healthy)', async () => {
    mockPrisma.speakingSubmission.findMany
      .mockResolvedValueOnce([
        {
          id: 10,
          status: 'PENDING',
          submittedAt: new Date(Date.now() - 20000),
          attemptCount: 0,
        },
        {
          id: 11,
          status: 'PENDING',
          submittedAt: new Date(Date.now() - 20000),
          attemptCount: 1,
        },
        {
          id: 12,
          status: 'PENDING',
          submittedAt: new Date(Date.now() - 20000),
          attemptCount: 1,
        },
      ]) // PENDING
      .mockResolvedValueOnce([]); // Stale PROCESSING

    mockQueue.getJob.mockImplementation((jobId: string) => {
      if (jobId.includes('10'))
        return Promise.resolve({ getState: () => Promise.resolve('waiting') });
      if (jobId.includes('11'))
        return Promise.resolve({ getState: () => Promise.resolve('active') });
      if (jobId.includes('12'))
        return Promise.resolve({ getState: () => Promise.resolve('delayed') });
      return Promise.resolve(null);
    });

    await scheduler.reconcilePendingSubmissions();

    expect(mockQueueService.enqueueSubmission).not.toHaveBeenCalled();
    expect(mockPrisma.speakingSubmission.update).not.toHaveBeenCalled();
  });

  it('2. Enqueues missing job for PENDING submission when not found in Redis', async () => {
    mockPrisma.speakingSubmission.findMany
      .mockResolvedValueOnce([
        {
          id: 20,
          status: 'PENDING',
          submittedAt: new Date(Date.now() - 20000),
          attemptCount: 0,
        },
      ])
      .mockResolvedValueOnce([]);

    mockQueue.getJob.mockResolvedValueOnce(null); // Not found in Redis

    await scheduler.reconcilePendingSubmissions();

    expect(mockQueueService.enqueueSubmission).toHaveBeenCalledWith(
      20,
      expect.stringContaining('reconcile-'),
    );
  });

  it('3. Recovers conflict when BullMQ job is completed but DB remains PENDING', async () => {
    mockPrisma.speakingSubmission.findMany
      .mockResolvedValueOnce([
        {
          id: 30,
          status: 'PENDING',
          submittedAt: new Date(Date.now() - 20000),
          attemptCount: 1,
        },
      ])
      .mockResolvedValueOnce([]);

    const mockCompletedJob = {
      getState: jest.fn().mockResolvedValue('completed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.getJob.mockResolvedValueOnce(mockCompletedJob);

    await scheduler.reconcilePendingSubmissions();

    // Removes stale completed job before re-enqueueing
    expect(mockCompletedJob.remove).toHaveBeenCalled();
    expect(mockQueueService.enqueueSubmission).toHaveBeenCalledWith(
      30,
      expect.stringContaining('reconcile-'),
    );
  });

  it('4. Recovers failed BullMQ job when DB is PENDING and retry attempts remain', async () => {
    mockPrisma.speakingSubmission.findMany
      .mockResolvedValueOnce([
        {
          id: 40,
          status: 'PENDING',
          submittedAt: new Date(Date.now() - 20000),
          attemptCount: 2,
        },
      ])
      .mockResolvedValueOnce([]);

    const mockFailedJob = {
      getState: jest.fn().mockResolvedValue('failed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.getJob.mockResolvedValueOnce(mockFailedJob);

    await scheduler.reconcilePendingSubmissions();

    expect(mockFailedJob.remove).toHaveBeenCalled();
    expect(mockQueueService.enqueueSubmission).toHaveBeenCalledWith(
      40,
      expect.stringContaining('reconcile-'),
    );
  });

  it('5. Marks DB FAILED when BullMQ job failed and maximum retry attempts are exhausted', async () => {
    mockPrisma.speakingSubmission.findMany
      .mockResolvedValueOnce([
        {
          id: 50,
          status: 'PENDING',
          submittedAt: new Date(Date.now() - 20000),
          attemptCount: 4,
        },
      ])
      .mockResolvedValueOnce([]);

    const mockFailedJob = {
      getState: jest.fn().mockResolvedValue('failed'),
      remove: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValueOnce(mockFailedJob);

    await scheduler.reconcilePendingSubmissions();

    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 50 },
        data: expect.objectContaining({
          status: 'FAILED',
          lastErrorCode: 'RETRY_EXHAUSTED',
        }),
      }),
    );
    expect(mockQueueService.enqueueSubmission).not.toHaveBeenCalled();
  });

  it('6. Recovers stale PROCESSING submission whose lease expired by resetting to PENDING and re-enqueueing', async () => {
    mockPrisma.speakingSubmission.findMany
      .mockResolvedValueOnce([]) // PENDING
      .mockResolvedValueOnce([
        {
          id: 60,
          status: 'PROCESSING',
          processingStartedAt: new Date(Date.now() - 6 * 60 * 1000), // 6 minutes ago
          attemptCount: 1,
        },
      ]); // Stale PROCESSING

    mockQueue.getJob.mockResolvedValueOnce(null); // Worker crashed, job evicted

    await scheduler.reconcilePendingSubmissions();

    expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 60, status: 'PROCESSING' },
        data: expect.objectContaining({
          status: 'PENDING',
          lastErrorCode: 'LEASE_EXPIRED_RESET',
        }),
      }),
    );

    expect(mockQueueService.enqueueSubmission).toHaveBeenCalledWith(
      60,
      expect.stringContaining('reconcile-'),
    );
  });
});
