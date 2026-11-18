import { ForbiddenException } from '@nestjs/common';
import { SubscriptionSource } from '@prisma/client';
import IORedis from 'ioredis';
import { describeWithIsolatedRedis } from '../../../test/safety/isolated';
import { TrialService } from './trial.service';

/**
 * Paid-level gradings of the 3-day PLUS trial sent at the same moment
 * (audit R11, 2026-11-18). The trial was checked, the answer graded, and
 * only then counted: two answers sent together with one grading left were
 * both graded and the count went past the limit.
 */
describeWithIsolatedRedis('TrialService.takeGrading on real Redis', () => {
  let redis: IORedis;
  const trialId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
  const key = `trial:gradings:${trialId}`;

  const service = () =>
    new TrialService(
      {
        subscription: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: trialId,
              startsAt: new Date(Date.now() - 3_600_000),
              endsAt: new Date(Date.now() + 2 * 86_400_000),
              source: SubscriptionSource.TRIAL,
            },
          ]),
        },
      } as never,
      redis,
    );

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
    });
  });

  afterEach(async () => {
    await redis.del(key);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('with one Writing grading left, two answers at once: one is graded, one refused', async () => {
    await redis.hset(key, 'WRITING', 2);
    const trial = service();

    const results = await Promise.allSettled([
      trial.takeGrading(1, 'WRITING'),
      trial.takeGrading(1, 'WRITING'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(
      ForbiddenException,
    );
    expect(Number(await redis.hget(key, 'WRITING'))).toBe(3);
  });

  it('five Speaking answers at once on a fresh trial: five graded, the sixth refused', async () => {
    const trial = service();

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => trial.takeGrading(1, 'SPEAKING')),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(Number(await redis.hget(key, 'SPEAKING'))).toBe(5);
  });

  it('a grading that fails is handed back', async () => {
    const trial = service();
    const refund = await trial.takeGrading(1, 'WRITING');
    expect(Number(await redis.hget(key, 'WRITING'))).toBe(1);

    await refund!();

    expect(Number(await redis.hget(key, 'WRITING'))).toBe(0);
  });
});
