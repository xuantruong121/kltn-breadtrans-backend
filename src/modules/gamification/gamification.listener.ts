import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from './gamification.service';

@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamificationService: GamificationService,
  ) {}

  @OnEvent('quiz.submitted')
  async handleQuizSubmittedEvent(payload: { userId: number; quizId?: number; score: number }) {
    this.logger.log(
      `Handling quiz.submitted event for user ${payload.userId} with score ${payload.score}`,
    );

    try {
      // Tính điểm thưởng (ví dụ: mỗi điểm số bài thi tương đương 10 points)
      const pointsEarned = payload.score * 10;

      if (pointsEarned > 0) {
        // 1 & 2. Thêm lịch sử điểm và Cập nhật bảng xếp hạng (bao gồm weeklyExp)
        const leaderboard = await this.gamificationService.addPoints(
          payload.userId,
          pointsEarned,
          'Hoàn thành bài thi (Quiz)',
        );

        // 3. Kiểm tra Huy hiệu (VD: Huy hiệu 100 điểm đầu tiên)
        // Trong thực tế, criteria nên được truy vấn từ DB để so sánh logic động.
        // Dưới đây là mã cứng demo:
        const firstBadge = await this.prisma.badge.findFirst({
          where: { name: 'Thợ săn điểm số' },
        });

        // Giả sử có huy hiệu này và user có điểm >= 100
        if (firstBadge && leaderboard.totalPoints >= 100) {
          const userBadgeExists = await this.prisma.userBadge.findUnique({
            where: {
              userId_badgeId: {
                userId: payload.userId,
                badgeId: firstBadge.id,
              },
            },
          });
          if (!userBadgeExists) {
            await this.prisma.userBadge.create({
              data: {
                userId: payload.userId,
                badgeId: firstBadge.id,
              },
            });
            this.logger.log(
              `Awarded badge ${firstBadge.name} to user ${payload.userId}`,
            );
          }
        }
      }

      // 4. Update Daily Quests
      const today = new Date().toISOString().split('T')[0];
      const activeQuests = await this.prisma.dailyQuest.findMany({
        where: { isActive: true, type: 'COMPLETE_QUIZ' },
      });

      for (const quest of activeQuests) {
        const progress = await this.prisma.userQuestProgress.upsert({
          where: {
            userId_questId_dateKey: {
              userId: payload.userId,
              questId: quest.id,
              dateKey: today,
            },
          },
          update: {
            currentValue: { increment: 1 },
          },
          create: {
            userId: payload.userId,
            questId: quest.id,
            dateKey: today,
            currentValue: 1,
          },
        });

        if (
          progress.currentValue >= quest.targetValue &&
          !progress.isCompleted
        ) {
          // Mark as completed
          await this.prisma.userQuestProgress.update({
            where: { id: progress.id },
            data: { isCompleted: true },
          });

          // Reward XP (sử dụng addPoints để bao gồm weeklyExp)
          if (quest.rewardXP > 0) {
            await this.gamificationService.addPoints(
              payload.userId,
              quest.rewardXP,
              `Hoàn thành nhiệm vụ: ${quest.title}`,
            );
          }

          // Reward Banh Ran (UserStats)
          if (quest.rewardBanh > 0) {
            const userStats = await this.prisma.userStats.findUnique({
              where: { userId: payload.userId },
            });
            if (userStats) {
              await this.prisma.userStats.update({
                where: { userId: payload.userId },
                data: {
                  totalBanhRan: { increment: quest.rewardBanh },
                },
              });
            } else {
              await this.prisma.userStats.create({
                data: {
                  userId: payload.userId,
                  totalBanhRan: quest.rewardBanh,
                },
              });
            }
          }

          this.logger.log(
            `User ${payload.userId} completed quest ${quest.id} and received rewards.`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle gamification for user ${payload.userId}`,
        error,
      );
    }
  }

  @OnEvent('vocab.learned')
  async handleVocabLearnedEvent(payload: { userId: number; count: number }) {
    this.logger.log(`Handling vocab.learned event for user ${payload.userId}`);
    try {
      // Tặng ngay 5 điểm (XP) cho mỗi từ vựng học được
      if (payload.count > 0) {
        await this.gamificationService.addPoints(
          payload.userId,
          payload.count * 5,
          `Học ${payload.count} từ vựng mới`,
        );
      }

      const today = new Date().toISOString().split('T')[0];
      const activeQuests = await this.prisma.dailyQuest.findMany({
        where: { isActive: true, type: 'LEARN_VOCAB' },
      });

      for (const quest of activeQuests) {
        const progress = await this.prisma.userQuestProgress.upsert({
          where: {
            userId_questId_dateKey: {
              userId: payload.userId,
              questId: quest.id,
              dateKey: today,
            },
          },
          update: {
            currentValue: { increment: payload.count },
          },
          create: {
            userId: payload.userId,
            questId: quest.id,
            dateKey: today,
            currentValue: payload.count,
          },
        });

        if (
          progress.currentValue >= quest.targetValue &&
          !progress.isCompleted
        ) {
          await this.prisma.userQuestProgress.update({
            where: { id: progress.id },
            data: { isCompleted: true },
          });

          if (quest.rewardXP > 0) {
            await this.gamificationService.addPoints(
              payload.userId,
              quest.rewardXP,
              `Hoàn thành nhiệm vụ: ${quest.title}`,
            );
          }

          if (quest.rewardBanh > 0) {
            const userStats = await this.prisma.userStats.findUnique({
              where: { userId: payload.userId },
            });
            if (userStats) {
              await this.prisma.userStats.update({
                where: { userId: payload.userId },
                data: { totalBanhRan: { increment: quest.rewardBanh } },
              });
            } else {
              await this.prisma.userStats.create({
                data: {
                  userId: payload.userId,
                  totalBanhRan: quest.rewardBanh,
                },
              });
            }
          }
          this.logger.log(
            `User ${payload.userId} completed quest ${quest.id} and received rewards.`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle vocab.learned for user ${payload.userId}`,
        error,
      );
    }
  }

  @OnEvent('gamification.xp_earned')
  async handleXpEarnedEvent(payload: { userId: number; points: number }) {
    if (payload.points <= 0) return;
    this.logger.log(`Handling gamification.xp_earned event for user ${payload.userId}`);
    try {
      const today = new Date().toISOString().split('T')[0];
      const activeQuests = await this.prisma.dailyQuest.findMany({
        where: { isActive: true, type: 'EARN_XP' },
      });

      for (const quest of activeQuests) {
        const progress = await this.prisma.userQuestProgress.upsert({
          where: {
            userId_questId_dateKey: {
              userId: payload.userId,
              questId: quest.id,
              dateKey: today,
            },
          },
          update: {
            currentValue: { increment: payload.points },
          },
          create: {
            userId: payload.userId,
            questId: quest.id,
            dateKey: today,
            currentValue: payload.points,
          },
        });

        if (
          progress.currentValue >= quest.targetValue &&
          !progress.isCompleted
        ) {
          await this.prisma.userQuestProgress.update({
            where: { id: progress.id },
            data: { isCompleted: true },
          });

          if (quest.rewardXP > 0) {
            await this.gamificationService.addPoints(
              payload.userId,
              quest.rewardXP,
              `Hoàn thành nhiệm vụ: ${quest.title}`,
            );
          }

          if (quest.rewardBanh > 0) {
            await this.prisma.userStats.upsert({
              where: { userId: payload.userId },
              update: { totalBanhRan: { increment: quest.rewardBanh } },
              create: {
                userId: payload.userId,
                totalBanhRan: quest.rewardBanh,
              },
            });
          }
          this.logger.log(
            `User ${payload.userId} completed quest ${quest.id} and received rewards.`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle gamification.xp_earned for user ${payload.userId}`,
        error,
      );
    }
  }
}
