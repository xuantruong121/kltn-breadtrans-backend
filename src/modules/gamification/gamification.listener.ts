import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('quiz.submitted')
  async handleQuizSubmittedEvent(payload: { userId: number; score: number }) {
    this.logger.log(
      `Handling quiz.submitted event for user ${payload.userId} with score ${payload.score}`,
    );

    try {
      // Tính điểm thưởng (ví dụ: mỗi điểm số bài thi tương đương 10 points)
      const pointsEarned = payload.score * 10;

      if (pointsEarned > 0) {
        // 1. Thêm lịch sử điểm
        await this.prisma.pointHistory.create({
          data: {
            userId: payload.userId,
            points: pointsEarned,
            reason: 'Hoàn thành bài thi (Quiz)',
          },
        });

        // 2. Cập nhật bảng xếp hạng
        const leaderboard = await this.prisma.leaderboard.upsert({
          where: { userId: payload.userId },
          update: { totalPoints: { increment: pointsEarned } },
          create: { userId: payload.userId, totalPoints: pointsEarned },
        });

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
    } catch (error) {
      this.logger.error(
        `Failed to handle gamification for user ${payload.userId}`,
        error,
      );
    }
  }
}
