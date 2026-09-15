import { GamificationService } from './gamification.service';

describe('GamificationService weekly cron hardening', () => {
  it('uses a fixed snapshot and records the processed week in GameSettings', async () => {
    const updates: any[] = [];
    const tx: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([]),
      gameSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      leaderboard: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, tier: 'Đồng', weeklyExp: 100 },
          { id: 2, tier: 'Đồng', weeklyExp: 50 },
          { id: 3, tier: 'Bạc', weeklyExp: 10 },
        ]),
        update: jest.fn().mockImplementation((args) => {
          updates.push(args);
          return args;
        }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    const redis = { set: jest.fn() };
    const service = new GamificationService(prisma, {} as any, redis as any);

    const result = await service.triggerWeeklyCron();

    expect(result.success).toBe(true);
    expect(updates.find((u) => u.where.id === 1).data.tier).toBe('Bạc');
    expect(updates.find((u) => u.where.id === 2).data.tier).toBe('Đồng');
    expect(updates.find((u) => u.where.id === 3).data.tier).toBe('Vàng');
    expect(tx.gameSettings.upsert).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalled();
  });

  it('returns no-op when the database advisory lock is unavailable', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: false }]),
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    const service = new GamificationService(
      prisma,
      {} as any,
      { set: jest.fn() } as any,
    );

    const result = await service.triggerWeeklyCron();

    expect(result).toEqual({
      success: true,
      noop: true,
      message: 'Weekly cron đang được xử lý bởi tiến trình khác.',
    });
  });

  it('uses completed quest count for dashboard summary percentage', async () => {
    const quests = [
      {
        id: 1,
        type: 'LEARN_VOCAB',
        title: 'Học 10 từ vựng',
        description: 'Học từ mới',
        targetValue: 10,
        rewardXP: 15,
        rewardBanh: 5,
      },
      {
        id: 2,
        type: 'COMPLETE_QUIZ',
        title: 'Làm 1 bài luyện nghe',
        description: 'Hoàn thành bài nghe',
        targetValue: 1,
        rewardXP: 20,
        rewardBanh: 8,
      },
      {
        id: 3,
        type: 'DO_SPEAKING',
        title: 'Luyện Speaking',
        description: 'Nộp bài nói',
        targetValue: 1,
        rewardXP: 25,
        rewardBanh: 10,
      },
      {
        id: 4,
        type: 'COMPLETE_LESSON',
        title: 'Hoàn thành bài học',
        description: 'Xem xong lesson',
        targetValue: 1,
        rewardXP: 20,
        rewardBanh: 8,
      },
    ];
    const prisma: any = {
      dailyQuest: { findMany: jest.fn().mockResolvedValue(quests) },
      userQuestProgress: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            questId: 1,
            currentValue: 10,
            isCompleted: true,
            quest: quests[0],
          },
          {
            id: 102,
            questId: 2,
            currentValue: 0,
            isCompleted: false,
            quest: quests[1],
          },
          {
            id: 103,
            questId: 3,
            currentValue: 0,
            isCompleted: false,
            quest: quests[2],
          },
          {
            id: 104,
            questId: 4,
            currentValue: 0,
            isCompleted: false,
            quest: quests[3],
          },
        ]),
      },
      learningActivity: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new GamificationService(
      prisma,
      {} as any,
      { set: jest.fn() } as any,
    );

    const result = await service.getDashboardToday(1);

    expect(result.summary).toEqual(
      expect.objectContaining({
        completedCount: 1,
        totalCount: 4,
        progressPercent: 25,
      }),
    );
    expect(result.quests[0].progressPercent).toBe(100);
  });

  describe('awardBanh & daily cap & idempotency', () => {
    it('enforces 150 daily cap and returns remainingDaily', async () => {
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([]) // INSERT DailyBanhEarning
          .mockResolvedValueOnce([{ id: 1, earnedBanh: 100 }]), // SELECT FOR UPDATE
        banhTransaction: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 99 }),
        },
        userStats: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ totalBanhRan: 100, doubleBanhUntil: null }),
          upsert: jest.fn().mockResolvedValue({ totalBanhRan: 150 }),
        },
        dailyBanhEarning: {
          update: jest.fn().mockResolvedValue({}),
        },
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      // Requests 80 Bánh Mì, but only 50 remaining until 150 daily cap
      const res = await service.awardBanh(1, 80, 'PRACTICE', 'test-ref-1', {
        isCapped: true,
      });

      expect(res.requested).toBe(80);
      expect(res.granted).toBe(50); // Capped at 150 - 100 = 50
      expect(res.rejected).toBe(30);
      expect(res.remainingDaily).toBe(0);
      expect(tx.dailyBanhEarning.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { earnedBanh: { increment: 50 } } }),
      );
    });

    it('returns granted: 0 without error when duplicate reference is supplied', async () => {
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        banhTransaction: {
          findUnique: jest.fn().mockResolvedValue({ id: 88, amount: 50 }),
        },
        userStats: {
          findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 100 }),
        },
        dailyBanhEarning: {
          findUnique: jest.fn().mockResolvedValue({ earnedBanh: 50 }),
        },
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      const res = await service.awardBanh(
        1,
        50,
        'QUIZ_FIRST_COMPLETION',
        'quiz:42',
      );

      expect(res.granted).toBe(0);
      expect(res.rejected).toBe(50);
      expect(res.newBalance).toBe(100);
      expect(tx.banhTransaction.create).toBeUndefined();
    });
  });

  describe('advanceDailyQuestAndGrantRewardsTx', () => {
    it('locks progress row, clamps progress and grants rewards on completion', async () => {
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 10, currentValue: 8, isCompleted: false },
          ]) // UserQuestProgress lock
          .mockResolvedValueOnce([]) // INSERT DailyBanhEarning
          .mockResolvedValueOnce([{ id: 1, earnedBanh: 0 }]), // SELECT DailyBanhEarning lock
        userQuestProgress: {
          upsert: jest.fn().mockResolvedValue({ id: 10 }),
          update: jest.fn().mockResolvedValue({}),
        },
        leaderboard: {
          findUnique: jest.fn().mockResolvedValue({ id: 1, userId: 2 }),
          update: jest.fn().mockResolvedValue({}),
        },
        pointHistory: {
          create: jest.fn().mockResolvedValue({}),
        },
        userStats: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ totalBanhRan: 10, doubleBanhUntil: null }),
          upsert: jest.fn().mockResolvedValue({ totalBanhRan: 20 }),
        },
        dailyBanhEarning: {
          update: jest.fn().mockResolvedValue({}),
        },
        banhTransaction: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      const quest = {
        id: 7,
        title: 'Nhiệm vụ',
        rewardXP: 50,
        rewardBanh: 10,
        targetValue: 10,
      };
      const res = await service.advanceDailyQuestAndGrantRewardsTx(
        2,
        quest,
        5,
        '2026-09-15',
      );

      expect(res.completedNow).toBe(true);
      expect(res.currentValue).toBe(10); // Clamped from 8 + 5 = 13 down to targetValue 10
      expect(tx.userQuestProgress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            currentValue: 10,
            isCompleted: true,
          }),
        }),
      );
      expect(tx.pointHistory.create).toHaveBeenCalled();
      expect(tx.banhTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 10,
            source: 'DAILY_QUEST',
            isCapped: true,
          }),
        }),
      );
    });
  });

  describe('feedPet atomic transaction', () => {
    it('checks 24h cooldown, deducts 10 Bánh Mì via CAS, and updates stats from current baseline', async () => {
      const now = new Date();
      const pastTime = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        userPet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            userId: 5,
            name: 'Mèo Máy Bánh Mì',
            level: 1,
            exp: 100,
            health: 80,
            happiness: 70,
            lastFedAt: pastTime,
            roster: {
              meo: {
                level: 1,
                exp: 100,
                health: 80,
                happiness: 70,
                lastFedAt: pastTime,
              },
            },
          }),
          update: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ ...data, id: 1 }),
            ),
        },
        userStats: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }), // CAS success
          findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 90 }),
        },
        banhTransaction: {
          create: jest.fn().mockResolvedValue({ id: 10 }),
        },
        badge: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      const pet = await service.feedPet(5);

      expect(tx.userStats.updateMany).toHaveBeenCalledWith({
        where: { userId: 5, totalBanhRan: { gte: 10 } },
        data: { totalBanhRan: { decrement: 10 } },
      });
      expect(tx.banhTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 5,
            amount: -10,
            source: 'PET_FEED',
            isCapped: false,
          }),
        }),
      );
      // Health 80 + 10 = 90, Happiness 70 + 20 = 90, Exp 100 + 50 = 150
      expect(pet.health).toBe(90);
      expect(pet.happiness).toBe(90);
      expect(pet.exp).toBe(150);
    });

    it('rejects feeding if 24 hours have not elapsed', async () => {
      const recentTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        userPet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            userId: 5,
            name: 'Mèo Máy Bánh Mì',
            lastFedAt: recentTime,
            roster: {
              meo: { lastFedAt: recentTime },
            },
          }),
        },
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      await expect(service.feedPet(5)).rejects.toThrow('Thú cưng chưa đói');
    });
  });

  describe('awardVocabMasteryReward', () => {
    it('awards 1 Bánh Mì on first mastery and rejects subsequent duplicate masteries', async () => {
      let isMastered = false;
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([]) // INSERT
          .mockResolvedValueOnce([{ id: 1, vocabCount: 5 }]) // SELECT vocabCount
          .mockResolvedValueOnce([]) // INSERT awardBanh
          .mockResolvedValueOnce([{ id: 1, earnedBanh: 10 }]), // SELECT awardBanh
        userVocabMasteryReward: {
          findUnique: jest
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                isMastered ? { id: 1, userId: 3, wordId: 99 } : null,
              ),
            ),
          create: jest.fn().mockImplementation(() => {
            isMastered = true;
            return Promise.resolve({ id: 1 });
          }),
        },
        dailyBanhEarning: {
          update: jest.fn().mockResolvedValue({}),
        },
        userStats: {
          findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 10 }),
          upsert: jest.fn().mockResolvedValue({ totalBanhRan: 11 }),
        },
        banhTransaction: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      const res1 = await service.awardVocabMasteryReward(3, 99);
      expect(res1.granted).toBe(1);

      // Second time for same word
      const res2 = await service.awardVocabMasteryReward(3, 99);
      expect(res2.granted).toBe(0);
      expect(res2.reason).toBe('ALREADY_MASTERED');
    });
  });

  describe('awardToeicReward', () => {
    it('awards 120 Bánh Mì for FULL_TEST and 0 for repeated attempt of same exam & mode', async () => {
      let rewarded = false;
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([]) // INSERT
          .mockResolvedValueOnce([{ id: 1, earnedBanh: 0 }]), // SELECT
        userToeicReward: {
          findUnique: jest
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                rewarded
                  ? { id: 1, userId: 4, examId: 1, mode: 'FULL_TEST' }
                  : null,
              ),
            ),
          create: jest.fn().mockImplementation(() => {
            rewarded = true;
            return Promise.resolve({ id: 1 });
          }),
        },
        userStats: {
          findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 0 }),
          upsert: jest.fn().mockResolvedValue({ totalBanhRan: 120 }),
        },
        dailyBanhEarning: {
          update: jest.fn().mockResolvedValue({}),
        },
        banhTransaction: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      const res1 = await service.awardToeicReward(4, 1, 'FULL_TEST', 10);
      expect(res1.granted).toBe(120);

      const res2 = await service.awardToeicReward(4, 1, 'FULL_TEST', 11);
      expect(res2.granted).toBe(0);
      expect(res2.reason).toBe('ALREADY_REWARDED');
    });
  });
});
