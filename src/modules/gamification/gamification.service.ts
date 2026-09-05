import { Injectable, BadRequestException, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from '../notifications/notifications.service';
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRedis() private readonly redis: Redis,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  async addPoints(userId: number, points: number, reason: string) {
    let myLeaderboard = await this.prisma.leaderboard.findUnique({
      where: { userId },
    });

    if (!myLeaderboard) {
      myLeaderboard = await this.prisma.leaderboard.create({
        data: { userId, tier: 'Đồng' },
      });
    }

    // 1. Lưu PointHistory
    await this.prisma.pointHistory.create({
      data: {
        userId,
        points,
        reason,
      },
    });

    // 2. Cập nhật Leaderboard
    const updatedLeaderboard = await this.prisma.leaderboard.update({
      where: { userId },
      data: {
        totalPoints: { increment: points },
        weeklyExp: { increment: points },
      },
    });

    // 3. Cập nhật UserStats (nếu cần dùng totalBanhRan thay thế điểm)
    await this.prisma.userStats.upsert({
      where: { userId },
      update: { totalBanhRan: { increment: points } },
      create: { userId, totalBanhRan: points },
    });

    // 4. Ghi nhận và cộng chuỗi Streak tự động
    await this.recordStreakActivity(userId);

    // Phát sự kiện xp_earned để listener cập nhật nhiệm vụ
    this.eventEmitter.emit('gamification.xp_earned', { userId, points });

    return updatedLeaderboard;
  }

  async recordStreakActivity(userId: number) {
    try {
      const now = new Date();
      const stats = await this.prisma.userStats.findUnique({
        where: { userId },
      });

      if (!stats) {
        await this.prisma.userStats.create({
          data: {
            userId,
            streakCount: 1,
            lastStreakUpdate: now,
          },
        });
        return;
      }

      const lastUpdate = stats.lastStreakUpdate
        ? new Date(stats.lastStreakUpdate)
        : null;
      if (!lastUpdate) {
        await this.prisma.userStats.update({
          where: { userId },
          data: { streakCount: 1, lastStreakUpdate: now },
        });
        return;
      }

      const nowDateStr = now.toISOString().split('T')[0];
      const lastDateStr = lastUpdate.toISOString().split('T')[0];

      // Nếu đã học trong cùng một ngày, không tăng thêm
      if (nowDateStr === lastDateStr) {
        return;
      }

      const nowMidnight = new Date(nowDateStr).getTime();
      const lastMidnight = new Date(lastDateStr).getTime();
      const diffDays = Math.round(
        (nowMidnight - lastMidnight) / (1000 * 60 * 60 * 24),
      );

      if (diffDays === 1) {
        // Học liên tiếp ngày hôm sau -> Tăng 1 ngày streak!
        await this.prisma.userStats.update({
          where: { userId },
          data: {
            streakCount: { increment: 1 },
            lastStreakUpdate: now,
          },
        });
      } else if (diffDays > 1) {
        // Cách hơn 1 ngày: Kiểm tra khiên bảo vệ
        if (stats.streakFreezes > 0) {
          await this.prisma.userStats.update({
            where: { userId },
            data: {
              streakFreezes: { decrement: 1 },
              streakCount: { increment: 1 },
              lastStreakUpdate: now,
            },
          });
        } else {
          // Bị ngắt chuỗi -> Bắt đầu lại từ 1
          await this.prisma.userStats.update({
            where: { userId },
            data: {
              streakCount: 1,
              lastStreakUpdate: now,
            },
          });
        }
      }
    } catch (err) {
      console.error('[Streak] Failed to update streak for user:', userId, err);
    }
  }

  async getLeaderboard(tier: string = 'Đồng') {
    return this.prisma.leaderboard.findMany({
      where: { tier },
      orderBy: { weeklyExp: 'desc' },
      take: 10,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: true,
          },
        },
      },
    });
  }

  async getMyBadges(userId: number) {
    // 1. Ensure standard 8 badges exist in database
    const DEFAULT_BADGES = [
      {
        name: 'Tân Binh',
        description: 'Đạt 100 điểm kinh nghiệm đầu tiên',
        criteria: { type: 'EXP', threshold: 100 },
      },
      {
        name: 'Chăm Chỉ',
        description: 'Duy trì chuỗi ngày học liên tục',
        criteria: { type: 'STREAK', threshold: 1 },
      },
      {
        name: 'Siêu Sao',
        description: 'Đạt Top 1 Bảng xếp hạng tuần',
        criteria: { type: 'LEADERBOARD_TOP1' },
      },
      {
        name: 'Thợ Săn',
        description: 'Thu thập đủ 1000 điểm kinh nghiệm',
        criteria: { type: 'EXP', threshold: 1000 },
      },
      {
        name: 'Học Bá',
        description: 'Đạt điểm tối đa trong các bài Quiz',
        criteria: { type: 'QUIZ', threshold: 1 },
      },
      {
        name: 'Đấu Sĩ Bất Bại',
        description: 'Thắng các trận so tài trong Đấu Trường',
        criteria: { type: 'ARENA', threshold: 1 },
      },
      {
        name: 'Giọng Đọc Vàng',
        description: 'Đạt điểm phát âm AI xuất sắc',
        criteria: { type: 'SPEAKING', threshold: 1 },
      },
      {
        name: 'Chuyên Gia Nuôi Thú',
        description: 'Nuôi thú cưng đạt Cấp độ 2 trở lên',
        criteria: { type: 'PET_LEVEL', threshold: 2 },
      },
    ];

    for (const b of DEFAULT_BADGES) {
      const existing = await this.prisma.badge.findFirst({
        where: { name: b.name },
      });
      if (!existing) {
        await this.prisma.badge.create({
          data: {
            name: b.name,
            description: b.description,
            iconUrl: '',
            criteria: b.criteria,
          },
        });
      }
    }

    // 2. Fetch user stats and leaderboard to automatically unlock earned badges
    const leaderboard = await this.prisma.leaderboard.findUnique({
      where: { userId },
    });
    const userStats = await this.prisma.userStats.findUnique({
      where: { userId },
    });
    const userPet = await this.prisma.userPet.findUnique({
      where: { userId },
    });

    const totalExp = leaderboard?.totalPoints || 0;
    const weeklyExp = leaderboard?.weeklyExp || 0;
    const streak = userStats?.streakCount || 0;
    const petLevel = userPet?.level || 1;

    const badgesToAward: string[] = [];

    // Milestone 1: Tân Binh (>= 100 EXP)
    if (totalExp >= 100 || weeklyExp >= 100) {
      badgesToAward.push('Tân Binh');
    }

    // Milestone 2: Thợ Săn (>= 1000 EXP)
    if (totalExp >= 1000 || weeklyExp >= 1000) {
      badgesToAward.push('Thợ Săn');
    }

    // Milestone 3: Chăm Chỉ (Streak >= 1)
    if (streak >= 1) {
      badgesToAward.push('Chăm Chỉ');
    }

    // Milestone 4: Siêu Sao (Top 1 Weekly Leaderboard)
    const topRank = await this.prisma.leaderboard.findFirst({
      orderBy: { weeklyExp: 'desc' },
    });
    if (topRank && topRank.userId === userId && weeklyExp > 0) {
      badgesToAward.push('Siêu Sao');
    }

    // Milestone 5: Chuyên Gia Nuôi Thú (Pet Level >= 2)
    if (petLevel >= 2) {
      badgesToAward.push('Chuyên Gia Nuôi Thú');
    }

    // Award all earned badges to user
    for (const badgeName of badgesToAward) {
      const badgeRecord = await this.prisma.badge.findFirst({
        where: { name: badgeName },
      });
      if (badgeRecord) {
        const userBadgeExists = await this.prisma.userBadge.findUnique({
          where: {
            userId_badgeId: {
              userId,
              badgeId: badgeRecord.id,
            },
          },
        });

        if (!userBadgeExists) {
          await this.prisma.userBadge.create({
            data: {
              userId,
              badgeId: badgeRecord.id,
            },
          });
        }
      }
    }

    return this.prisma.userBadge.findMany({
      where: { userId },
      include: {
        badge: true,
      },
    });
  }

  // ==========================================
  // PET & DAILY QUESTS (INDEPENDENT PER-SPECIES SYSTEM)
  // ==========================================

  private normalizeSpeciesKey(name?: string): string {
    if (!name) return 'bready';
    const n = name.trim().toLowerCase();
    if (
      n.includes('cú') ||
      n === 'owly' ||
      n.includes('owl') ||
      n.includes('thông thái') ||
      n.includes('cử nhân')
    ) {
      return 'owly';
    }
    if (
      n.includes('mèo bánh cá') ||
      n.includes('taiyaki') ||
      n === 'mimi' ||
      n.includes('mimi') ||
      n.includes('nơ hồng') ||
      n.includes('thiên thần')
    ) {
      return 'mimi';
    }
    if (
      n.includes('cáo') ||
      n === 'foxy' ||
      n.includes('fox') ||
      n.includes('phim')
    ) {
      return 'foxy';
    }
    return 'bready';
  }

  async getMyPet(userId: number) {
    let pet = await this.prisma.userPet.findUnique({
      where: { userId },
    });

    if (!pet) {
      const initialRoster = {
        bready: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          lastFedAt: null,
        },
        owly: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          lastFedAt: null,
        },
        mimi: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          lastFedAt: null,
        },
        foxy: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          lastFedAt: null,
        },
      };
      pet = await this.prisma.userPet.create({
        data: {
          userId,
          name: 'Bánh Mì Dũng Cảm',
          health: 100,
          happiness: 100,
          level: 1,
          exp: 0,
          roster: initialRoster,
        } as any,
      });
      return pet;
    }

    const currentSpecies = this.normalizeSpeciesKey(pet.name);
    const roster = ((pet as any).roster as Record<string, any>) || {};

    // Ensure roster has current species initialized
    if (!roster[currentSpecies]) {
      roster[currentSpecies] = {
        level: pet.level || 1,
        exp: pet.exp || 0,
        health: pet.health ?? 100,
        happiness: pet.happiness ?? 100,
        lastFedAt: pet.lastFedAt,
      };
    }

    // Dynamic Time-Based Decay for active pet
    const activePetData = roster[currentSpecies];
    const now = new Date().getTime();
    const lastFedTime = activePetData.lastFedAt
      ? new Date(activePetData.lastFedAt).getTime()
      : new Date(pet.createdAt).getTime();
    const hoursSinceLastFed = Math.floor(
      (now - lastFedTime) / (1000 * 60 * 60),
    );

    if (hoursSinceLastFed >= 24) {
      const daysPassed = Math.floor(hoursSinceLastFed / 24);
      const healthDecay = daysPassed * 10;
      const happinessDecay = daysPassed * 15;

      const newHealth = Math.max(20, 100 - healthDecay);
      const newHappiness = Math.max(20, 100 - happinessDecay);

      if (
        newHealth !== activePetData.health ||
        newHappiness !== activePetData.happiness
      ) {
        activePetData.health = newHealth;
        activePetData.happiness = newHappiness;
        roster[currentSpecies] = activePetData;

        pet = await this.prisma.userPet.update({
          where: { userId },
          data: {
            health: newHealth,
            happiness: newHappiness,
            roster: roster as any,
          } as any,
        });
      }
    }

    return pet;
  }

  async feedPet(userId: number) {
    const pet = await this.getMyPet(userId);

    // Check if UserStats exists and has enough Banh Ran
    let userStats = await this.prisma.userStats.findUnique({
      where: { userId },
    });

    if (!userStats) {
      userStats = await this.prisma.userStats.create({
        data: { userId, totalBanhRan: 0 },
      });
    }

    if (userStats.totalBanhRan < 10) {
      throw new BadRequestException(
        'Bạn không đủ 10 Bánh Rán để cho thú cưng ăn!',
      );
    }

    // Tiêu thụ 10 Bánh Rán
    await this.prisma.userStats.update({
      where: { userId },
      data: { totalBanhRan: { decrement: 10 } },
    });

    const currentSpecies = this.normalizeSpeciesKey(pet.name);
    const roster = ((pet as any).roster as Record<string, any>) || {};
    const activePetData = roster[currentSpecies] || {
      level: pet.level || 1,
      exp: pet.exp || 0,
      health: pet.health ?? 100,
      happiness: pet.happiness ?? 100,
      lastFedAt: null,
    };

    const newExp = (activePetData.exp || 0) + 50;
    const newLevel = Math.floor(newExp / 1000) + 1;
    const newHappiness = Math.min((activePetData.happiness ?? 100) + 20, 100);
    const newHealth = Math.min((activePetData.health ?? 100) + 10, 100);
    const now = new Date();

    activePetData.exp = newExp;
    activePetData.level = newLevel;
    activePetData.happiness = newHappiness;
    activePetData.health = newHealth;
    activePetData.lastFedAt = now;
    roster[currentSpecies] = activePetData;

    return this.prisma.userPet.update({
      where: { userId },
      data: {
        level: newLevel,
        exp: newExp,
        happiness: newHappiness,
        health: newHealth,
        lastFedAt: now,
        roster: roster as any,
      } as any,
    });
  }

  async changePetType(userId: number, targetPetName: string) {
    const pet = await this.getMyPet(userId);
    const currentSpecies = this.normalizeSpeciesKey(pet.name);
    const targetSpecies = this.normalizeSpeciesKey(targetPetName);

    const roster = ((pet as any).roster as Record<string, any>) || {};

    // 1. Save current active pet stats into roster
    roster[currentSpecies] = {
      level: pet.level || 1,
      exp: pet.exp || 0,
      health: pet.health ?? 100,
      happiness: pet.happiness ?? 100,
      lastFedAt: pet.lastFedAt,
    };

    // 2. Retrieve or initialize target pet stats
    if (!roster[targetSpecies]) {
      roster[targetSpecies] = {
        level: 1,
        exp: 0,
        health: 100,
        happiness: 100,
        lastFedAt: null,
      };
    }

    const targetData = roster[targetSpecies];

    // 3. Switch active pet to target pet stats
    return this.prisma.userPet.update({
      where: { userId },
      data: {
        name: targetPetName,
        level: targetData.level || 1,
        exp: targetData.exp || 0,
        health: targetData.health ?? 100,
        happiness: Math.min((targetData.happiness ?? 100) + 15, 100),
        lastFedAt: targetData.lastFedAt,
        roster: roster as any,
      } as any,
    });
  }

  async getMyDailyQuests(userId: number) {
    const today = new Date().toISOString().split('T')[0];

    // Get active quests
    let activeQuests = await this.prisma.dailyQuest.findMany({
      where: { isActive: true },
      take: 3,
    });

    if (activeQuests.length === 0) {
      // Auto-create default quests if none exist (since we don't use mock data)
      await this.prisma.dailyQuest.createMany({
        data: [
          {
            title: 'Hoàn thành 1 bài Luyện Nghe',
            targetValue: 1,
            type: 'COMPLETE_QUIZ',
            rewardXP: 50,
            rewardBanh: 10,
          },
          {
            title: 'Đạt 100 điểm kinh nghiệm',
            targetValue: 100,
            type: 'EARN_XP',
            rewardXP: 20,
            rewardBanh: 5,
          },
          {
            title: 'Học 10 từ vựng',
            targetValue: 10,
            type: 'LEARN_VOCAB',
            rewardXP: 30,
            rewardBanh: 5,
          },
        ],
      });
      activeQuests = await this.prisma.dailyQuest.findMany({
        where: { isActive: true },
        take: 3,
      });
    }

    // Ensure user has progress records for today
    const progresses = [];
    for (const quest of activeQuests) {
      const progress = await this.prisma.userQuestProgress.upsert({
        where: {
          userId_questId_dateKey: {
            userId,
            questId: quest.id,
            dateKey: today,
          },
        },
        update: {},
        create: {
          userId,
          questId: quest.id,
          dateKey: today,
          currentValue: 0, // NO MOCK DATA
        },
        include: {
          quest: true,
        },
      });
      progresses.push(progress);
    }

    return progresses;
  }

  async recordVocabLearned(userId: number, count: number = 1) {
    const validCount = Math.max(1, count || 1);
    await this.eventEmitter.emitAsync('vocab.learned', {
      userId,
      count: validCount,
    });
    return { success: true, count: validCount };
  }

  async getArenaSnippet(userId: number) {
    const myLeaderboard = await this.prisma.leaderboard.findUnique({
      where: { userId },
    });
    const tier = myLeaderboard?.tier || 'Đồng';

    const leaderboard = await this.getLeaderboard(tier);
    const myRankIndex = leaderboard.findIndex(
      (entry) => entry.userId === userId,
    );

    if (myRankIndex === -1) {
      return {
        rank: null,
        tier: 'Đồng',
        message: 'Bạn chưa có mặt trên bảng xếp hạng tuần này.',
      };
    }

    const nextRank = myRankIndex > 0 ? leaderboard[myRankIndex - 1] : null;
    const diff = nextRank
      ? nextRank.weeklyExp - leaderboard[myRankIndex].weeklyExp
      : 0;

    return {
      rank: myRankIndex + 1,
      tier,
      message:
        diff > 0
          ? `Bạn đang cách Top ${myRankIndex} chỉ ${diff} điểm!`
          : `Tuyệt vời! Bạn đang dẫn đầu bảng xếp hạng.`,
    };
  }

  // ==========================================
  // ADVANCED GAMIFICATION (LEAGUES, STREAKS, WHEEL)
  // ==========================================

  async spinWheel(userId: number) {
    const COST = 50;
    const userStats = await this.prisma.userStats.findUnique({
      where: { userId },
    });
    if (!userStats || userStats.totalBanhRan < COST) {
      throw new BadRequestException('Không đủ 50 Bánh Rán để quay!');
    }

    // Trừ tiền
    await this.prisma.userStats.update({
      where: { userId },
      data: { totalBanhRan: { decrement: COST } },
    });
    await this.prisma.pointHistory.create({
      data: { userId, points: -COST, reason: 'Quay vòng quay may mắn' },
    });

    const rand = Math.random() * 100;
    let reward = '';
    let rewardType = '';

    if (rand < 5) {
      // 5% trúng Jackpot (Vé giảm học phí)
      reward = '1 Voucher Giảm 5% Học phí';
      rewardType = 'voucher';
      await this.prisma.pointHistory.create({
        data: { userId, points: 0, reason: 'Jackpot: Voucher Giảm 5% Học phí' },
      });
    } else if (rand < 20) {
      // 15% trúng 100 Bánh Rán (lời)
      reward = '100 Bánh Rán';
      rewardType = 'points';
      await this.addPoints(userId, 100, 'Trúng thưởng vòng quay');
    } else if (rand < 40) {
      // 20% trúng vé streak
      reward = '1 Vé Bảo vệ Chuỗi';
      rewardType = 'streak_freeze';
      await this.prisma.userStats.update({
        where: { userId },
        data: { streakFreezes: { increment: 1 } },
      });
    } else {
      // 60% trúng 20 Bánh Rán (lỗ)
      reward = '20 Bánh Rán';
      rewardType = 'points';
      await this.addPoints(userId, 20, 'Trúng thưởng vòng quay');
    }

    return { success: true, reward, rewardType };
  }

  async triggerDailyCron() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const stats = await this.prisma.userStats.findMany({
      where: {
        lastStreakUpdate: { lt: yesterday },
        streakCount: { gt: 0 },
      },
    });

    for (const stat of stats) {
      if (stat.streakFreezes > 0) {
        await this.prisma.userStats.update({
          where: { id: stat.id },
          data: {
            streakFreezes: { decrement: 1 },
            lastStreakUpdate: new Date(), // giả vờ như đã học để không bị trừ tiếp vào ngày mai
          },
        });
      } else {
        await this.prisma.userStats.update({
          where: { id: stat.id },
          data: { streakCount: 0 },
        });
      }
    }
    return {
      success: true,
      message: `Processed ${stats.length} inactive users.`,
    };
  }

  async triggerWeeklyCron(isManualTrigger = false) {
    const tiers = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương'];
    const now = new Date();
    const year = now.getFullYear();
    const firstDay = new Date(year, 0, 1);
    const week = Math.ceil(
      ((now.getTime() - firstDay.getTime()) / 86400000 + firstDay.getDay() + 1) / 7,
    );
    const weekKey = `${year}-W${String(week).padStart(2, '0')}`;
    const maxAttempts = isManualTrigger ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.prisma.$transaction(async (tx) => {
        const lockResult: any = await tx.$queryRaw`
          SELECT pg_try_advisory_xact_lock(hashtext('cron-weekly-league')) AS locked
        `;
        if (!lockResult?.[0]?.locked) {
          return { acquired: false, noop: true };
        }

        await tx.$queryRaw`
          SELECT * FROM GameSettings
          WHERE gameId = 'cron-weekly-league'
          FOR UPDATE
        `;
        const setting = await tx.gameSettings.findUnique({
          where: { gameId: 'cron-weekly-league' },
        });
        const config = (setting?.config as Record<string, unknown> | null) || {};
        if (config.lastProcessedWeek === weekKey) {
          return { acquired: true, noop: true };
        }

        const snapshot = await tx.leaderboard.findMany({
          orderBy: [{ weeklyExp: 'desc' }, { id: 'asc' }],
        });
        const updates: Array<{ id: number; tier: string; weeklyExp: number }> = [];
        for (let i = 0; i < tiers.length; i++) {
          const currentTier = tiers[i];
          const users = snapshot.filter((u) => u.tier === currentTier);
          const topCount = Math.max(1, Math.floor(users.length * 0.2));
          const bottomStart = Math.max(users.length - Math.floor(users.length * 0.2), topCount);
          users.forEach((user, index) => {
            let newTier = currentTier;
            if (index < topCount && i < tiers.length - 1) newTier = tiers[i + 1];
            else if (index >= bottomStart && i > 0) newTier = tiers[i - 1];
            updates.push({ id: user.id, tier: newTier, weeklyExp: 0 });
          });
        }

        for (const update of updates) {
          await tx.leaderboard.update({
            where: { id: update.id },
            data: { tier: update.tier, weeklyExp: update.weeklyExp },
          });
        }

        await tx.gameSettings.upsert({
          where: { gameId: 'cron-weekly-league' },
          update: {
            config: { lastProcessedWeek: weekKey, processedAt: now.toISOString() },
          },
          create: {
            gameId: 'cron-weekly-league',
            config: { lastProcessedWeek: weekKey, processedAt: now.toISOString() },
          },
        });
        return { acquired: true, noop: false };
      });

      if (result.acquired) {
        await this.redis.set(`gamification:cron:weekly:${weekKey}:completed`, '1', 'EX', 7 * 86400);
        return {
          success: true,
          noop: result.noop,
          message: result.noop
            ? `Tuần ${weekKey} đã được xử lý trước đó.`
            : `Weekly league ${weekKey} processed successfully.`,
        };
      }
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return { success: true, noop: true, message: 'Weekly cron đang được xử lý bởi tiến trình khác.' };
  }

  // ================= CRON SCHEDULES (Asia/Ho_Chi_Minh) =================

  @Cron('0 0 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleDailyCronSchedule() {
    if (process.env.CRON_INTERNAL_ENABLED === 'true') {
      this.logger.log('[GamificationService] Executing automated daily streak cronjob...');
      try {
        const res = await this.triggerDailyCron();
        this.logger.log(`[GamificationService] Daily streak cron completed: ${res.message}`);
      } catch (err) {
        this.logger.error('[GamificationService] Daily streak cron failed:', err);
      }
    }
  }

  @Cron('0 0 * * 0', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleWeeklyCronSchedule() {
    if (process.env.CRON_INTERNAL_ENABLED === 'true') {
      this.logger.log('[GamificationService] Executing automated weekly leagues cronjob...');
      try {
        const res = await this.triggerWeeklyCron();
        this.logger.log(`[GamificationService] Weekly leagues cron completed: ${res.message}`);
      } catch (err) {
        this.logger.error('[GamificationService] Weekly leagues cron failed:', err);
      }
    }
  }

  async sendAdmiration(
    senderId: number,
    targetUserId: number,
    message?: string,
  ) {
    if (senderId === targetUserId) {
      throw new BadRequestException(
        'Bạn không thể tự gửi ngưỡng mộ cho chính mình!',
      );
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      include: { profile: true },
    });

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { stats: true },
    });

    if (!targetUser) {
      throw new BadRequestException('Không tìm thấy học viên nhận ngưỡng mộ!');
    }

    const senderName =
      sender?.profile?.fullName || sender?.email || 'Một bạn học';
    const admirationMsg =
      message || 'Rất ngưỡng mộ thành tích học tập của bạn! Cùng cố gắng nhé!';

    // Send Web Push Notification to target user
    if (this.notificationsService) {
      void this.notificationsService.sendPushToUser(targetUserId, {
        title: '⭐ Bạn nhận được lời ngưỡng mộ mới!',
        body: `${senderName}: "${admirationMsg}"`,
        icon: sender?.profile?.avatar || '/icons/icon-192.png',
        url: '/student/profile',
      });
    }

    return {
      success: true,
      message: `Đã gửi lời ngưỡng mộ tới bạn học thành công!`,
    };
  }
}
