import { SpeakingWorkerService } from './speaking-worker.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AiService } from '../ai/ai.service';
import type { UploadService } from '../upload/upload.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { SpeakingPostProcessingService } from './speaking-post-processing.service';
import type { SpeakingQueueService } from './speaking-queue.service';

/**
 * Legacy mode has no BullMQ consumer: the poller itself must finish feedback
 * and reward for completed submissions, retry a failure a bounded number of
 * times, and never enqueue jobs that nobody will run.
 */
describe('SpeakingWorkerService legacy post-processing sweep', () => {
  const now = Date.now();
  let findMany: jest.Mock;
  let post: { processReward: jest.Mock; processFeedback: jest.Mock };
  let queue: { enqueueFeedback: jest.Mock; enqueueReward: jest.Mock };
  let worker: SpeakingWorkerService;

  beforeEach(() => {
    findMany = jest.fn();
    post = {
      processReward: jest.fn().mockResolvedValue(undefined),
      processFeedback: jest.fn().mockResolvedValue(undefined),
    };
    queue = { enqueueFeedback: jest.fn(), enqueueReward: jest.fn() };
    worker = new SpeakingWorkerService(
      { speakingSubmission: { findMany } } as unknown as PrismaService,
      {} as AiService,
      {} as UploadService,
      {} as EventEmitter2,
      queue as unknown as SpeakingQueueService,
      undefined,
      post as unknown as SpeakingPostProcessingService,
    );
  });

  const sweep = () =>
    (
      worker as unknown as { sweepPostProcessing(): Promise<void> }
    ).sweepPostProcessing();

  it('runs reward before feedback and never enqueues', async () => {
    findMany
      .mockResolvedValueOnce([{ id: 7, processedAt: new Date(now) }])
      .mockResolvedValueOnce([{ id: 7, processedAt: new Date(now) }]);
    await sweep();
    expect(post.processReward).toHaveBeenCalledWith(7, 'legacy-reward-7', 1, 4);
    expect(post.processFeedback).toHaveBeenCalledWith(
      7,
      'legacy-feedback-7',
      1,
      4,
    );
    expect(post.processReward.mock.invocationCallOrder[0]).toBeLessThan(
      post.processFeedback.mock.invocationCallOrder[0],
    );
    expect(queue.enqueueReward).not.toHaveBeenCalled();
    expect(queue.enqueueFeedback).not.toHaveBeenCalled();
  });

  it('only claims rows that are PENDING past the backoff or whose lease expired', async () => {
    findMany.mockResolvedValue([]);
    await sweep();
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('COMPLETED');
    expect(where.OR).toEqual([
      { rewardStatus: 'PENDING', rewardStartedAt: null },
      { rewardStatus: 'PENDING', rewardStartedAt: { lte: expect.any(Date) } },
      {
        rewardStatus: 'PROCESSING',
        rewardStartedAt: { lte: expect.any(Date) },
      },
    ]);
  });

  it('makes the attempt terminal once the retry window is over', async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 9, processedAt: new Date(now - 10 * 60_000) },
      ]);
    await sweep();
    expect(post.processFeedback).toHaveBeenCalledWith(
      9,
      'legacy-feedback-9',
      4,
      4,
    );
  });

  it('a failing row does not stop the sweep', async () => {
    findMany
      .mockResolvedValueOnce([
        { id: 1, processedAt: new Date(now) },
        { id: 2, processedAt: new Date(now) },
      ])
      .mockResolvedValueOnce([]);
    post.processReward.mockRejectedValueOnce(new Error('db blip'));
    await expect(sweep()).resolves.toBeUndefined();
    expect(post.processReward).toHaveBeenCalledTimes(2);
  });
});
