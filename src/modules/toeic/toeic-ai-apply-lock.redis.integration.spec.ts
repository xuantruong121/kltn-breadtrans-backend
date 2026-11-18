import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import IORedis from 'ioredis';
import { describeWithIsolatedRedis } from '../../../test/safety/isolated';
import { ToeicAiExamService } from './toeic-ai-exam.service';

// The private parts of the service this spec sets or replaces.
type Locked = {
  apply: ToeicAiExamService['apply'];
  connection: unknown;
  applyLocked: jest.Mock;
  logger: { warn: jest.Mock };
};

/**
 * Two Apply clicks on one AI job (audit A3, 2026-11-18): the second is
 * refused while the first runs, against a real Redis.
 */
describeWithIsolatedRedis('ToeicAiExamService.apply lock on real Redis', () => {
  let redis: IORedis;
  const jobId = `qa-apply-lock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const make = (connection: unknown) => {
    const service = Object.create(
      ToeicAiExamService.prototype,
    ) as unknown as Locked;
    service.connection = connection;
    service.logger = { warn: jest.fn() };
    return service;
  };

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
    });
  });

  afterAll(async () => {
    await redis.del(`toeic-ai-apply:${jobId}`);
    await redis.quit();
  });

  it('a second Apply while the first runs gets 409; the job is written once', async () => {
    const service = make(redis);
    let finish!: () => void;
    service.applyLocked = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true });
        }),
    );

    const first = service.apply(jobId, 1);
    // Let the first take the lock before the second click lands.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(service.apply(jobId, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    finish();
    await expect(first).resolves.toEqual({ ok: true });
    expect(service.applyLocked).toHaveBeenCalledTimes(1);

    // Released: the next Apply runs.
    expect(await redis.exists(`toeic-ai-apply:${jobId}`)).toBe(0);
    service.applyLocked.mockResolvedValueOnce({ ok: 'again' });
    await expect(service.apply(jobId, 1)).resolves.toEqual({ ok: 'again' });
  });

  it('a failing Apply still frees the job', async () => {
    const service = make(redis);
    service.applyLocked = jest.fn().mockRejectedValue(new Error('media down'));
    await expect(service.apply(jobId, 1)).rejects.toThrow('media down');
    expect(await redis.exists(`toeic-ai-apply:${jobId}`)).toBe(0);
  });

  it('Redis not answering: 503, nothing applied', async () => {
    jest.useFakeTimers();
    try {
      const service = make({ set: () => new Promise(() => undefined) });
      service.applyLocked = jest.fn();
      const pending = service.apply(jobId, 1);
      const settled = expect(pending).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(3_001);
      await settled;
      expect(service.applyLocked).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
