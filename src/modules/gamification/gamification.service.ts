import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  async addPoints(userId: number, points: number, reason: string) {
    // 1. Ghi log PointHistory
    await this.prisma.pointHistory.create({
      data: {
        userId,
        points,
        reason
      }
    });

    // 2. Cập nhật Leaderboard
    await this.prisma.leaderboard.upsert({
      where: { userId },
      update: { totalPoints: { increment: points } },
      create: { userId, totalPoints: points }
    });

    // 3. Cập nhật UserStats (nếu cần dùng totalBanhRan thay thế điểm)
    await this.prisma.userStats.upsert({
      where: { userId },
      update: { totalBanhRan: { increment: points } },
      create: { userId, totalBanhRan: points }
    });
  }

  async getLeaderboard() {
    return this.prisma.leaderboard.findMany({
      orderBy: { totalPoints: 'desc' },
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
      where: { userId }
    });

    if (!pet) {
      pet = await this.prisma.userPet.create({
        data: {
          userId,
          name: 'Bánh Mì',
          health: 100,
          happiness: 100,
          level: 1,
          exp: 0
        }
      });
    }

    return pet;
  }

  async feedPet(userId: number) {
    const pet = await this.getMyPet(userId);
    
    // Simulate consuming 10 Banh Ran (points) to feed
    await this.prisma.userStats.update({
      where: { userId },
      data: { totalBanhRan: { decrement: 10 } }
    });

    return this.prisma.userPet.update({
      where: { userId },
      data: {
        happiness: Math.min(pet.happiness + 20, 100),
        health: Math.min(pet.health + 10, 100),
        exp: pet.exp + 50,
        lastFedAt: new Date()
      }
    });
  }

  async getMyDailyQuests(userId: number) {
    const today = new Date().toISOString().split('T')[0];
    
    // Get active quests
    let activeQuests = await this.prisma.dailyQuest.findMany({
      where: { isActive: true },
      take: 3
    });

    if (activeQuests.length === 0) {
      // Auto-create default quests if none exist (since we don't use mock data)
      await this.prisma.dailyQuest.createMany({
        data: [
          { title: "Hoàn thành 1 bài luyện nói", targetValue: 1, type: "DO_SPEAKING", rewardXP: 50, rewardBanh: 10 },
          { title: "Đạt 100 điểm kinh nghiệm", targetValue: 100, type: "EARN_XP", rewardXP: 20, rewardBanh: 5 },
          { title: "Học 10 từ vựng", targetValue: 10, type: "LEARN_VOCAB", rewardXP: 30, rewardBanh: 5 }
        ]
      });
      activeQuests = await this.prisma.dailyQuest.findMany({
        where: { isActive: true },
        take: 3
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
            dateKey: today
          }
        },
        update: {},
        create: {
          userId,
          questId: quest.id,
          dateKey: today,
          currentValue: 0 // NO MOCK DATA
        },
        include: {
          quest: true
        }
      });
      progresses.push(progress);
    }

    return progresses;
  }

  async getArenaSnippet(userId: number) {
    const leaderboard = await this.getLeaderboard();
    const myRankIndex = leaderboard.findIndex(entry => entry.userId === userId);
    
    if (myRankIndex === -1) {
      return {
        rank: null,
        tier: 'Đồng',
        message: 'Bạn chưa có mặt trên bảng xếp hạng.'
      };
    }

    const tier = myRankIndex < 3 ? 'Vàng' : myRankIndex < 7 ? 'Bạc' : 'Đồng';
    const nextRank = myRankIndex > 0 ? leaderboard[myRankIndex - 1] : null;
    const diff = nextRank ? nextRank.totalPoints - leaderboard[myRankIndex].totalPoints : 0;

    return {
      rank: myRankIndex + 1,
      tier,
      message: diff > 0 
        ? `Bạn đang cách Top ${myRankIndex} chỉ ${diff} điểm!`
        : `Tuyệt vời! Bạn đang dẫn đầu bảng xếp hạng.`
    };
  }
}
