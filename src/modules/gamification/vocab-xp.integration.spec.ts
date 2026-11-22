import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { VOCAB_XP_DAILY_CAP, VOCAB_XP_REASON } from '../vocab/vocab-xp.logic';
import { GamificationService } from './gamification.service';

/**
 * Flashcard XP (owner 2026-11-18): 2 XP the first time a learner knows a
 * word, 150 a day at most, and no Bánh mì.
 */
describeWithIsolatedDatabase('GamificationService.awardVocabWordXp', () => {
  let prisma: PrismaService;
  let service: GamificationService;
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userIds: number[] = [];

  const learner = async (tag: string) => {
    const user = await prisma.user.create({
      data: { email: `vocab_xp_${tag}_${suffix}@breadtrans.local` },
    });
    userIds.push(user.id);
    return user.id;
  };
  const flashcardXp = async (userId: number) =>
    (
      await prisma.pointHistory.aggregate({
        where: { userId, reason: { startsWith: VOCAB_XP_REASON } },
        _sum: { points: true },
      })
    )._sum.points ?? 0;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new GamificationService(
      prisma,
      { emit: jest.fn() } as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('one word pays once, even known twice at the same moment, and gives no Bánh mì', async () => {
    const userId = await learner('once');

    const paid = await Promise.all([
      service.awardVocabWordXp(userId, 501),
      service.awardVocabWordXp(userId, 501),
    ]);
    // Known again later (unmarked, then marked): nothing more.
    const again = await service.awardVocabWordXp(userId, 501);

    expect(paid.sort()).toEqual([0, 2]);
    expect(again).toBe(0);
    expect(await flashcardXp(userId)).toBe(2);
    expect(await prisma.banhTransaction.count({ where: { userId } })).toBe(0);
  });

  // 80 awards run one after another on the learner's lock: about 2 s alone,
  // 2.5 s with four copies at once, but the suite took 16 s in a full run on
  // 2026-11-21 and failed on jest's default 5 s (then passed alone).
  const CAP_TEST_TIMEOUT_MS = 60_000;

  it(
    '80 words, 8 at a time, stop at the 150 XP daily cap',
    async () => {
      const userId = await learner('cap');

      // Eight at once: more would wait on the connection pool, not the lock.
      for (let start = 0; start < 80; start += 8)
        await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            service.awardVocabWordXp(userId, 1000 + start + i),
          ),
        );

      expect(await flashcardXp(userId)).toBe(VOCAB_XP_DAILY_CAP);
    },
    CAP_TEST_TIMEOUT_MS,
  );
});
