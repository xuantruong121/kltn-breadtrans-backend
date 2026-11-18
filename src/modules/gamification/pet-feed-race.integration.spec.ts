import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { GamificationService, getTodayDateKey } from './gamification.service';

type PetRow = { roster: Record<string, { satiety: number }> };

/**
 * Opening the pet page while the pet is being fed (audit R10, 2026-11-18):
 * getMyPet read the pet without the feed lock and, when decay changed it,
 * wrote the whole roster back. A feed committed in between, Bánh Mì already
 * spent, was erased.
 */
describeWithIsolatedDatabase('pet page versus feeding', () => {
  let prisma: PrismaService;
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userIds: number[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.banhTransaction.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const newHungryPet = async () => {
    const user = await prisma.user.create({
      data: { email: `pet_race_${suffix}_${userIds.length}@breadtrans.local` },
    });
    userIds.push(user.id);
    await prisma.userStats.create({
      data: { userId: user.id, totalBanhRan: 500 },
    });
    const longAgo = new Date(Date.now() - 5 * 3_600_000).toISOString();
    await prisma.userPet.create({
      data: {
        userId: user.id,
        name: 'Bánh Mì Dũng Cảm',
        health: 100,
        happiness: 100,
        level: 1,
        exp: 0,
        roster: {
          bready: {
            level: 1,
            exp: 0,
            health: 100,
            happiness: 100,
            satiety: 40,
            lastFedAt: null,
            stateUpdatedAt: longAgo,
            dailyFeedDateKey: '2000-01-01',
            dailyFeedCount: 0,
            dailyRewardedFeedCount: 0,
          },
        },
      },
    });
    return user.id;
  };

  it('a feed landing between the page read and its write is kept', async () => {
    const userId = await newHungryPet();
    const feeder = new GamificationService(
      prisma,
      { emit: jest.fn() } as never,
      {} as never,
    );
    let fed: { satiety: number } | undefined;
    let firstRead = true;
    // The page's first, unlocked read of the pet returns, then the whole feed
    // commits, then the page goes on with what it read.
    const pausing = new Proxy(prisma, {
      get(target, prop) {
        const value = (target as unknown as Record<string | symbol, unknown>)[
          prop
        ];
        if (prop === 'userPet') {
          const delegate = value as Record<
            string,
            (...a: unknown[]) => unknown
          >;
          return new Proxy(delegate, {
            get(d, method) {
              const fn = d[method as string];
              if (method === 'findUnique' && typeof fn === 'function')
                return async (...args: unknown[]) => {
                  const row = await fn.apply(d, args);
                  if (firstRead) {
                    firstRead = false;
                    fed = (await feeder.feedPet(userId)) as unknown as {
                      satiety: number;
                    };
                  }
                  return row;
                };
              return typeof fn === 'function' ? fn.bind(d) : fn;
            },
          });
        }
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const page = new GamificationService(
      pausing as never,
      { emit: jest.fn() } as never,
      {} as never,
    );

    await page.getMyPet(userId);

    expect(fed).toBeDefined();
    const row = (await prisma.userPet.findUniqueOrThrow({
      where: { userId },
    })) as unknown as PetRow;
    expect(row.roster.bready.satiety).toBe(fed!.satiety);
    expect(
      await prisma.banhTransaction.count({
        where: { userId, source: 'PET_FEED' },
      }),
    ).toBe(1);
    expect(getTodayDateKey('Asia/Ho_Chi_Minh')).toMatch(/^\d{4}-/);
  });
});
