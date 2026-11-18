import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { GamificationService } from './gamification.service';

/**
 * The nightly streak job and a learner studying at 00:01 (audit R4,
 * 2026-11-18). The job read its batch, then wrote each row without checking
 * it again: a learner who used a shield in between had a second shield
 * taken (down to -1) and a second notice.
 */
describeWithIsolatedDatabase('nightly streak job versus a learner', () => {
  let prisma: PrismaService;
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userIds: number[] = [];
  let savedSetting: { config: unknown } | null = null;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    savedSetting = await prisma.gameSettings.findUnique({
      where: { gameId: 'cron-daily-streak' },
      select: { config: true },
    });
  });

  afterAll(async () => {
    // The job marks the day as done; put the shared setting back.
    if (savedSetting)
      await prisma.gameSettings.update({
        where: { gameId: 'cron-daily-streak' },
        data: { config: savedSetting.config as object },
      });
    else
      await prisma.gameSettings.deleteMany({
        where: { gameId: 'cron-daily-streak' },
      });
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('a shield the learner uses while the job runs is not taken a second time', async () => {
    const user = await prisma.user.create({
      data: { email: `streak_cron_${suffix}@breadtrans.local` },
    });
    userIds.push(user.id);
    await prisma.userStats.create({
      data: {
        userId: user.id,
        streakCount: 5,
        streakFreezes: 1,
        lastStreakUpdate: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    await prisma.gameSettings.deleteMany({
      where: { gameId: 'cron-daily-streak' },
    });

    const learner = new GamificationService(
      prisma,
      { emit: jest.fn() } as never,
      {} as never,
    );
    let learnerRan = false;
    // The job's batch read sees only this learner (other rows in the test
    // database stay untouched); right after the first read, the learner
    // studies and commits a shield use.
    const wrapTx = (tx: object) =>
      new Proxy(tx, {
        get(target, prop) {
          const value = (target as Record<string | symbol, unknown>)[prop];
          if (prop !== 'userStats')
            return typeof value === 'function'
              ? (value as (...a: unknown[]) => unknown).bind(target)
              : value;
          const delegate = value as Record<
            string,
            (...a: unknown[]) => Promise<unknown>
          >;
          return new Proxy(delegate, {
            get(d, method) {
              const fn = d[method as string];
              if (method !== 'findMany')
                return typeof fn === 'function' ? fn.bind(d) : fn;
              return async (...args: unknown[]) => {
                const rows = (await fn.apply(d, args)) as { userId: number }[];
                const mine = rows.filter((r) => r.userId === user.id);
                if (mine.length && !learnerRan) {
                  learnerRan = true;
                  await learner.recordStreakActivity(user.id);
                }
                return mine;
              };
            },
          });
        },
      });
    const jobPrisma = new Proxy(prisma, {
      get(target, prop) {
        if (prop === '$transaction')
          return (cb: (tx: object) => unknown) =>
            target.$transaction((tx) => cb(wrapTx(tx)) as Promise<unknown>);
        const value = (target as unknown as Record<string | symbol, unknown>)[
          prop
        ];
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const job = new GamificationService(
      jobPrisma,
      { emit: jest.fn() } as never,
      {} as never,
    );

    await job.triggerDailyCron();

    expect(learnerRan).toBe(true);
    const stats = await prisma.userStats.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stats.streakFreezes).toBe(0);
    expect(stats.streakCount).toBe(6);
    expect(
      await prisma.notification.count({ where: { userId: user.id } }),
    ).toBe(1);
  });
});
