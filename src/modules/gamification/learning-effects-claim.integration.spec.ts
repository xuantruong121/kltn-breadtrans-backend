import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { LearningEffectsQueueService } from './learning-effects-queue.service';

/**
 * The inline fallback and a queue job that landed late run the same
 * submission at the same moment (audit C1, 2026-11-18). The claim row is
 * INSERT ... ON CONFLICT DO NOTHING on Postgres: one of the two gets it.
 */
describeWithIsolatedDatabase('LearningEffectsQueueService claim race', () => {
  let prisma: PrismaService;
  const submissionId = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.learningEffectClaim.deleteMany({ where: { submissionId } });
    await prisma.$disconnect();
  });

  it('two runs of one submission at once apply its effects once', async () => {
    const listener = {
      handleQuizSubmittedEvent: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = {
      get: jest.fn(() => {
        throw new Error('no skill progress here');
      }),
    };
    const service = new LearningEffectsQueueService(
      listener as never,
      moduleRef as never,
      prisma,
    );
    const payload = { userId: 1, quizId: 1, submissionId, score: 3 };

    await Promise.all([service.run(payload), service.run(payload)]);

    expect(listener.handleQuizSubmittedEvent).toHaveBeenCalledTimes(1);
    expect(
      await prisma.learningEffectClaim.count({ where: { submissionId } }),
    ).toBe(1);
  });
});
