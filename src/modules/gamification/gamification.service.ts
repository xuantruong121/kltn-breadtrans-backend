import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

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
          }
        }
      }
    });
  }

  async getMyBadges(userId: number) {
    return this.prisma.userBadge.findMany({
      where: { userId },
      include: {
        badge: true,
      }
    });
  }
}
