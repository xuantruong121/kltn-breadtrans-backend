import {
  GamificationService,
  getTodayDateKey,
  getPetSatietyState,
  reconcilePetDecay,
  normalizeSpeciesPetState,
  normalizeDailyCounters,
  SATIETY_DECAY_INTERVAL_HOURS,
  SATIETY_DECAY_AMOUNT,
  HAPPINESS_DECAY_INTERVAL_HOURS,
  HAPPINESS_DECAY_AMOUNT,
  STARVATION_THRESHOLD,
  HEALTH_DECAY_INTERVAL_HOURS,
  HEALTH_DECAY_AMOUNT,
} from './gamification.service';

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
          update: jest.fn().mockResolvedValue({}),
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

  describe('pet domain logic & decay rules', () => {
    it('defines named domain decay constants', () => {
      expect(SATIETY_DECAY_INTERVAL_HOURS).toBe(4);
      expect(SATIETY_DECAY_AMOUNT).toBe(8);
      expect(HAPPINESS_DECAY_INTERVAL_HOURS).toBe(24);
      expect(HAPPINESS_DECAY_AMOUNT).toBe(5);
      expect(STARVATION_THRESHOLD).toBe(20);
      expect(HEALTH_DECAY_INTERVAL_HOURS).toBe(6);
      expect(HEALTH_DECAY_AMOUNT).toBe(5);
    });

    it('maps satiety levels to deterministic satiety states', () => {
      expect(getPetSatietyState(100)).toBe('FULL');
      expect(getPetSatietyState(80)).toBe('FULL');
      expect(getPetSatietyState(79)).toBe('NORMAL');
      expect(getPetSatietyState(50)).toBe('NORMAL');
      expect(getPetSatietyState(49)).toBe('HUNGRY');
      expect(getPetSatietyState(20)).toBe('HUNGRY');
      expect(getPetSatietyState(19)).toBe('VERY_HUNGRY');
      expect(getPetSatietyState(0)).toBe('VERY_HUNGRY');
    });

    it('reconciles decay idempotently: repeated calls do not re-decay without elapsed time', () => {
      const now = new Date('2026-09-18T10:00:00.000Z');
      const past = new Date('2026-09-18T05:00:00.000Z'); // 5 hours ago
      const state = normalizeSpeciesPetState({
        level: 1,
        exp: 0,
        health: 100,
        happiness: 100,
        satiety: 100,
        stateUpdatedAt: past.toISOString(),
      });

      // Call 1: 5 hours elapsed -> 1 interval (4h) -> satiety -8 -> 92
      const firstRun = reconcilePetDecay(state, now);
      expect(firstRun.changed).toBe(true);
      expect(firstRun.state.satiety).toBe(92);
      expect(firstRun.state.stateUpdatedAt).toBe(now.toISOString());

      // Call 2 (immediate repeated call with same now timestamp): 0 elapsed -> NO additional decay
      const secondRun = reconcilePetDecay(firstRun.state, now);
      expect(secondRun.changed).toBe(false);
      expect(secondRun.state.satiety).toBe(92);
      expect(secondRun.state.stateUpdatedAt).toBe(now.toISOString());
    });

    it('health does not decay merely from normal time, but decreases only during prolonged starvation (satiety < 20)', () => {
      const now = new Date('2026-09-18T12:00:00.000Z');
      // Case A: Satiety is 100, 20 hours passed.
      // Satiety decays: floor(20/4) * 8 = 40 -> 60 (>= 20, never reached starvation).
      const wellFedState = normalizeSpeciesPetState({
        level: 1,
        exp: 0,
        health: 100,
        happiness: 100,
        satiety: 100,
        stateUpdatedAt: new Date(
          now.getTime() - 20 * 3600 * 1000,
        ).toISOString(),
      });
      const wellFedResult = reconcilePetDecay(wellFedState, now);
      expect(wellFedResult.state.satiety).toBe(60);
      expect(wellFedResult.state.health).toBe(100); // Health MUST NOT decay!

      // Case B: Pet is already starving (satiety = 10 < 20). 12 hours pass.
      // 12 hours of starvation / 6 hours interval = 2 intervals * 5 = -10 health.
      const starvingState = normalizeSpeciesPetState({
        level: 1,
        exp: 0,
        health: 90,
        happiness: 80,
        satiety: 10,
        stateUpdatedAt: new Date(
          now.getTime() - 12 * 3600 * 1000,
        ).toISOString(),
      });
      const starvingResult = reconcilePetDecay(starvingState, now);
      expect(starvingResult.state.health).toBe(80); // 90 - 10 = 80
      expect(starvingResult.state.satiety).toBe(0); // 10 - floor(12/4)*8 = 0
    });

    it('happiness decay is independent from feeding timestamp (5 points per 24 hours)', () => {
      const now = new Date('2026-09-18T12:00:00.000Z');
      const state = normalizeSpeciesPetState({
        level: 1,
        exp: 0,
        health: 100,
        happiness: 95,
        satiety: 100,
        lastFedAt: new Date(now.getTime() - 1 * 3600 * 1000).toISOString(), // fed 1h ago
        stateUpdatedAt: new Date(
          now.getTime() - 24 * 3600 * 1000,
        ).toISOString(), // state anchor 24h ago
      });
      const result = reconcilePetDecay(state, now);
      expect(result.state.happiness).toBe(90); // 95 - 5 = 90
    });

    it('daily counters reset only when date changes, without resetting pet stats', () => {
      const state = normalizeSpeciesPetState({
        level: 2,
        exp: 1500,
        health: 85,
        happiness: 75,
        satiety: 60,
        dailyFeedDateKey: '2026-09-17',
        dailyFeedCount: 4,
        dailyRewardedFeedCount: 3,
      });

      const norm = normalizeDailyCounters(state, '2026-09-18');
      expect(norm.reset).toBe(true);
      expect(norm.state.dailyFeedCount).toBe(0);
      expect(norm.state.dailyRewardedFeedCount).toBe(0);
      expect(norm.state.dailyFeedDateKey).toBe('2026-09-18');
      // Stats must remain completely untouched
      expect(norm.state.level).toBe(2);
      expect(norm.state.exp).toBe(1500);
      expect(norm.state.health).toBe(85);
      expect(norm.state.happiness).toBe(75);
      expect(norm.state.satiety).toBe(60);
    });
  });

  describe('feedPet atomic transaction', () => {
    it('uses satiety, escalates feed cost (10 -> 20 -> 30), and clamps increments', async () => {
      const now = new Date();
      const pastTime = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
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
                satiety: 40, // HUNGRY (< 80)
                lastFedAt: pastTime.toISOString(),
                stateUpdatedAt: pastTime.toISOString(),
                dailyFeedDateKey: getTodayDateKey('Asia/Ho_Chi_Minh'),
                dailyFeedCount: 0,
                dailyRewardedFeedCount: 0,
              },
            },
          }),
          update: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ ...data, id: 1, name: 'Mèo Máy Bánh Mì' }),
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

      // Cost for feed #1 is 10 Bánh Mì
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
      // Feeding benefits: Satiety +35, Health +10, Happiness +5, EXP +5 (first 3 feeds)
      expect(pet.health).toBe(90);
      expect(pet.happiness).toBe(75);
      expect(pet.satiety).toBe(75);
      expect(pet.exp).toBe(105);
      expect(pet.dailyFeedCount).toBe(1);
      expect(pet.dailyRewardedFeedCount).toBe(1);
    });

    it('rejects feeding when satiety >= 80 (FULL)', async () => {
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        userPet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            userId: 5,
            name: 'Mèo Máy Bánh Mì',
            roster: {
              meo: {
                level: 1,
                exp: 100,
                health: 40,
                happiness: 30,
                satiety: 85, // FULL
                stateUpdatedAt: new Date().toISOString(),
              },
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

      await expect(service.feedPet(5)).rejects.toThrow(
        'Thú cưng đang no, chưa cần ăn thêm. Hãy quay lại khi pet đói hơn.',
      );
    });

    it('feed 4+ awards 0 EXP and costs 30 Bánh Mì', async () => {
      const now = new Date();
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        userPet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            userId: 5,
            name: 'Bready',
            level: 1,
            exp: 100,
            health: 80,
            happiness: 70,
            roster: {
              bready: {
                level: 1,
                exp: 100,
                health: 80,
                happiness: 70,
                satiety: 30,
                stateUpdatedAt: now.toISOString(),
                dailyFeedDateKey: getTodayDateKey('Asia/Ho_Chi_Minh'),
                dailyFeedCount: 3, // 4th feed
                dailyRewardedFeedCount: 3, // reached reward limit
              },
            },
          }),
          update: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ ...data, id: 1, name: 'Bready' }),
            ),
        },
        userStats: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 100 }),
        },
        banhTransaction: { create: jest.fn().mockResolvedValue({ id: 11 }) },
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

      // Cost is 30
      expect(tx.userStats.updateMany).toHaveBeenCalledWith({
        where: { userId: 5, totalBanhRan: { gte: 30 } },
        data: { totalBanhRan: { decrement: 30 } },
      });
      // Zero EXP awarded on 4th feed
      expect(pet.exp).toBe(100);
      expect(pet.dailyFeedCount).toBe(4);
      expect(pet.dailyRewardedFeedCount).toBe(3);
    });

    it('rejects feeding when user does not have enough Bánh Mì (CAS fails)', async () => {
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        userPet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            userId: 5,
            name: 'Bready',
            roster: {
              bready: {
                level: 1,
                exp: 0,
                health: 50,
                happiness: 50,
                satiety: 30,
                stateUpdatedAt: new Date().toISOString(),
                dailyFeedCount: 0,
                dailyRewardedFeedCount: 0,
              },
            },
          }),
        },
        userStats: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }), // CAS failure
          findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 5 }),
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

      await expect(service.feedPet(5)).rejects.toThrow(
        'Bạn không đủ 10 Bánh Mì để cho thú cưng ăn!',
      );
    });
  });

  describe('changePetType', () => {
    it('switches species and preserves each species state without +15 happiness bump', async () => {
      const currentPet = {
        id: 1,
        userId: 5,
        name: 'Bánh Mì Dũng Cảm', // bready
        level: 3,
        exp: 2500,
        health: 88,
        happiness: 72,
        satiety: 65,
        lastFedAt: new Date().toISOString(),
        stateUpdatedAt: new Date().toISOString(),
        roster: {
          bready: {
            level: 3,
            exp: 2500,
            health: 88,
            happiness: 72,
            satiety: 65,
            lastFedAt: new Date().toISOString(),
            stateUpdatedAt: new Date().toISOString(),
          },
          owly: {
            level: 1,
            exp: 100,
            health: 90,
            happiness: 80,
            satiety: 70,
            lastFedAt: null,
            stateUpdatedAt: new Date().toISOString(),
          },
        },
      };

      const prisma: any = {
        userPet: {
          findUnique: jest.fn().mockResolvedValue(currentPet),
          update: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              id: 1,
              userId: 5,
              name: data.name,
              level: data.level,
              exp: data.exp,
              health: data.health,
              happiness: data.happiness,
              roster: data.roster,
            }),
          ),
        },
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      const switched = await service.changePetType(5, 'Cú Thông Thái'); // owly

      expect(switched.name).toBe('Cú Thông Thái');
      expect(switched.level).toBe(1);
      expect(switched.exp).toBe(100);
      expect(switched.health).toBe(90);
      // MUST NOT have arbitrary +15 happiness bonus
      expect(switched.happiness).toBe(80);
      expect(switched.satiety).toBe(70);
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
                isMastered
                  ? { id: 1, userId: 3, wordId: 99, banhGranted: 1 }
                  : null,
              ),
            ),
          create: jest.fn().mockImplementation(() => {
            isMastered = true;
            return Promise.resolve({ id: 1 });
          }),
          update: jest.fn().mockResolvedValue({}),
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
          findUnique: jest.fn().mockImplementation(() =>
            Promise.resolve(
              rewarded
                ? {
                    id: 1,
                    userId: 4,
                    examId: 1,
                    mode: 'FULL_TEST',
                    banhGranted: 120,
                  }
                : null,
            ),
          ),
          create: jest.fn().mockImplementation(() => {
            rewarded = true;
            return Promise.resolve({ id: 1 });
          }),
          update: jest.fn().mockResolvedValue({}),
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

  describe('Streak management and rollover', () => {
    it('clears streakCount to 0 without overwriting lastStreakUpdate when freezes are 0', async () => {
      const updates: any[] = [];
      const tx: any = {
        userStats: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: 10,
                streakCount: 5,
                streakFreezes: 0,
                lastStreakUpdate: new Date('2026-09-10T00:00:00Z'),
              },
            ])
            .mockResolvedValueOnce([]),
          update: jest.fn().mockImplementation((args) => {
            updates.push(args);
            return Promise.resolve(args);
          }),
        },
        gameSettings: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({}),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
      };
      const prisma: any = {
        $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
      };
      const service = new GamificationService(
        prisma,
        { emit: jest.fn() } as any,
        {} as any,
      );

      const res = await service.triggerDailyCron('2026-09-16');
      expect(res.success).toBe(true);
      expect(updates[0]).toEqual({
        where: { id: 10 },
        data: { streakCount: 0 },
      });
      // lastStreakUpdate should NOT be updated in the data payload
      expect(updates[0].data.lastStreakUpdate).toBeUndefined();
    });

    it('restores streak to 1 when user studies on same day if streakCount is 0', async () => {
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        userStats: {
          findUnique: jest.fn().mockResolvedValue({
            userId: 15,
            streakCount: 0,
            streakFreezes: 0,
            lastStreakUpdate: new Date(),
          }),
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

      await service.recordStreakActivity(15);

      expect(tx.userStats.update).toHaveBeenCalledWith({
        where: { userId: 15 },
        data: expect.objectContaining({
          streakCount: 1,
        }),
      });
    });
  });
});
