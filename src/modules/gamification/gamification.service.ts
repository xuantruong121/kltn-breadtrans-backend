import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class GamificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
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
    return this.prisma.userBadge.findMany({
      where: { userId },
      include: {
        badge: true,
      },
    });
  }

  // ==========================================
  // PET & DAILY QUESTS
  // ==========================================

  async getMyPet(userId: number) {
    let pet = await this.prisma.userPet.findUnique({
      where: { userId },
    });

    if (!pet) {
      pet = await this.prisma.userPet.create({
        data: {
          userId,
          name: 'Bánh Mì',
          health: 100,
          happiness: 100,
          level: 1,
          exp: 0,
        },
      });
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

    const newExp = pet.exp + 50;
    const newLevel = Math.floor(newExp / 1000) + 1;
    let newName = pet.name;

    // Tiến hóa thú cưng dựa trên level
    if (newLevel >= 10) newName = 'Vua Bánh Mì';
    else if (newLevel >= 7) newName = 'Bánh Kem Hoàng Gia';
    else if (newLevel >= 4) newName = 'Bánh Macaron';
    else if (newLevel >= 2) newName = 'Bánh Sừng Bò';

    return this.prisma.userPet.update({
      where: { userId },
      data: {
        name: newName,
        level: newLevel,
        happiness: Math.min(pet.happiness + 20, 100),
        health: Math.min(pet.health + 10, 100),
        exp: newExp,
        lastFedAt: new Date(),
      },
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

  async triggerWeeklyCron() {
    const tiers = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương'];

    for (let i = 0; i < tiers.length; i++) {
      const currentTier = tiers[i];
      const usersInTier = await this.prisma.leaderboard.findMany({
        where: { tier: currentTier },
        orderBy: { weeklyExp: 'desc' },
      });

      if (usersInTier.length === 0) continue;

      const top20Index = Math.max(1, Math.floor(usersInTier.length * 0.2));
      const bottom20Index = Math.max(
        usersInTier.length - Math.floor(usersInTier.length * 0.2),
        top20Index,
      );

      for (let j = 0; j < usersInTier.length; j++) {
        const u = usersInTier[j];
        let newTier = currentTier;

        // Thăng hạng (nếu chưa phải cao nhất)
        if (j < top20Index && i < tiers.length - 1) {
          newTier = tiers[i + 1];
        }
        // Giáng hạng (nếu chưa phải thấp nhất)
        else if (j >= bottom20Index && i > 0) {
          newTier = tiers[i - 1];
        }

        await this.prisma.leaderboard.update({
          where: { id: u.id },
          data: { tier: newTier, weeklyExp: 0 },
        });
      }
    }
    return { success: true, message: 'Leagues updated successfully.' };
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
