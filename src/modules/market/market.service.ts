import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMarketOrderDto } from './dto/create-order.dto';
import { AdjustCurrencyDto } from './dto/adjust-currency.dto';

@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  async getProducts() {
    let products = await this.prisma.marketProduct.findMany({
      orderBy: { order: 'asc' },
    });

    if (products.length === 0) {
      // Auto seed default items
      await this.prisma.marketProduct.createMany({
        data: [
          {
            name: 'Khiên Bảo Vệ Chuỗi (Streak Freeze)',
            price: 100,
            order: 1,
            imageUrl: '🛡️',
          },
          {
            name: 'Thẻ Nhân Đôi Bánh Mì (2X Boost)',
            price: 150,
            order: 2,
            imageUrl: '⚡',
          },
          {
            name: 'Vương Miện Hoàng Gia (Avatar Frame)',
            price: 300,
            order: 3,
            imageUrl: '👑',
          },
          {
            name: 'Huy Hiệu Học Bá TOEIC',
            price: 500,
            order: 4,
            imageUrl: '🎖️',
          },
          {
            name: 'Voucher Trà Sữa 30k',
            price: 1000,
            order: 5,
            imageUrl: '🧋',
          },
        ],
      });
      products = await this.prisma.marketProduct.findMany({
        orderBy: { order: 'asc' },
      });
    }

    return products;
  }

  async getCurrencyBalance(userId: number) {
    const stats = await this.prisma.userStats.findUnique({
      where: { userId },
    });
    const leaderboard = await this.prisma.leaderboard.findUnique({
      where: { userId },
    });

    return {
      totalBanh: stats?.totalBanhRan || 0,
      streakCount: stats?.streakCount || 0,
      streakFreezes: stats?.streakFreezes || 0,
      totalPoints: leaderboard?.totalPoints || 0,
      weeklyExp: leaderboard?.weeklyExp || 0,
      tier: leaderboard?.tier || 'Đồng',
    };
  }

  async getCurrencyHistory(userId: number) {
    return this.prisma.pointHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createOrder(userId: number, dto: CreateMarketOrderDto) {
    const totalBanh = Number(dto.totalBanh);
    if (totalBanh <= 0) {
      throw new BadRequestException('Số lượng Bánh Mì thanh toán không hợp lệ');
    }

    const stats = await this.prisma.userStats.findUnique({
      where: { userId },
    });

    if (!stats || stats.totalBanhRan < totalBanh) {
      throw new BadRequestException(
        `Bạn không đủ Bánh Mì để đổi thưởng (Cần ${totalBanh} Bánh Mì, hiện có ${stats?.totalBanhRan || 0})`,
      );
    }

    // Deduct Bánh Mì
    await this.prisma.userStats.update({
      where: { userId },
      data: { totalBanhRan: { decrement: totalBanh } },
    });

    const items = dto.items || [];
    const itemNames = items.map((i) => i.name || 'Vật phẩm').join(', ');

    // Create PointHistory
    await this.prisma.pointHistory.create({
      data: {
        userId,
        points: -totalBanh,
        reason: `Đổi vật phẩm cửa hàng: ${itemNames}`,
      },
    });

    // Check item effects (e.g. Streak Freeze item)
    for (const item of items) {
      const name = item.name || '';
      if (
        item.type === 'streak_freeze' ||
        item.id === 'streak-freeze' ||
        name.includes('Khiên')
      ) {
        const qty = item.quantity || 1;
        await this.prisma.userStats.update({
          where: { userId },
          data: { streakFreezes: { increment: qty } },
        });
      }
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
    });

    // Create Order Record
    const order = await this.prisma.marketOrder.create({
      data: {
        userId,
        studentName: dto.studentName || profile?.fullName || 'Học viên',
        items: dto.items as any,
        totalK: dto.totalK || 0,
        totalBanh,
        status: 'approved',
        paidAtCheckout: true,
        balanceAtCheckout: stats.totalBanhRan - totalBanh,
      },
    });

    return {
      success: true,
      message: 'Đổi vật phẩm thành công!',
      orderId: order.id,
      remainingBanh: stats.totalBanhRan - totalBanh,
    };
  }

  async getMyOrders(userId: number) {
    return this.prisma.marketOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Admin APIs
  async getAllOrders() {
    return this.prisma.marketOrder.findMany({
      orderBy: { createdAt: 'desc' },
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

  async reviewOrder(orderId: number, status: string, reviewerName: string) {
    const order = await this.prisma.marketOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return this.prisma.marketOrder.update({
      where: { id: orderId },
      data: {
        status,
        reviewedBy: reviewerName,
        reviewedAt: new Date(),
      },
    });
  }

  async adjustCurrency(dto: AdjustCurrencyDto, adminName: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }

    const updatedStats = await this.prisma.userStats.upsert({
      where: { userId: dto.userId },
      update: { totalBanhRan: { increment: dto.amount } },
      create: { userId: dto.userId, totalBanhRan: Math.max(0, dto.amount) },
    });

    await this.prisma.pointHistory.create({
      data: {
        userId: dto.userId,
        points: dto.amount,
        reason: `[Admin: ${adminName}] ${dto.reason}`,
      },
    });

    await this.prisma.currencyTransaction.create({
      data: {
        studentId: dto.userId,
        studentName: user.email,
        userId: dto.userId,
        userName: adminName,
        userRole: 'ADMIN',
        amount: dto.amount,
        reason: dto.reason,
        type: dto.amount >= 0 ? 'add' : 'subtract',
      },
    });

    return {
      success: true,
      message: `Đã điều chỉnh ${dto.amount} Bánh Mì cho học viên ID ${dto.userId}`,
      currentBanh: updatedStats.totalBanhRan,
    };
  }
}
