import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { CreateMarketOrderDto } from './dto/create-order.dto';
import { AdjustCurrencyDto } from './dto/adjust-currency.dto';

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

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
            name: 'Thẻ Nhân Đôi Bánh Mì (24h Boost)',
            price: 200,
            order: 2,
            imageUrl: '⚡',
          },
          {
            name: 'Huy Hiệu Bậc Thầy Từ Vựng',
            price: 150,
            order: 3,
            imageUrl: '🏅',
          },
          {
            name: 'Vương Miện Quán Quân (Avatar Frame)',
            price: 500,
            order: 4,
            imageUrl: '👑',
          },
          {
            name: 'Sổ Tay Học Từ Vựng Mini',
            price: 1200,
            order: 5,
            imageUrl: '📔',
          },
          {
            name: 'Voucher Trà Sữa 20k',
            price: 2000,
            order: 6,
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

    // Kiểm tra xem đơn hàng có chứa Quà tặng thực tế / Voucher cần Admin duyệt hay không
    const hasRealGift = (items as Array<Record<string, any>>).some((item) => {
      const cat = String(item?.category || '');
      const name = String(item?.name || '');
      return (
        cat === 'gift' ||
        name.includes('Voucher') ||
        name.includes('Sổ Tay') ||
        name.includes('Quà')
      );
    });

    const initialStatus = hasRealGift ? 'pending' : 'approved';

    // Create Order Record
    const order = await this.prisma.marketOrder.create({
      data: {
        userId,
        studentName: dto.studentName || profile?.fullName || 'Học viên',
        items: dto.items as any,
        totalK: dto.totalK || 0,
        totalBanh,
        status: initialStatus,
        paidAtCheckout: true,
        balanceAtCheckout: stats.totalBanhRan - totalBanh,
      },
    });

    return {
      success: true,
      status: initialStatus,
      message: hasRealGift
        ? 'Yêu cầu đổi quà đã được gửi tới Ban Quản Trị! Vui lòng chờ phê duyệt nhé 🎁'
        : 'Đổi vật phẩm thành công!',
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

    // Nếu Admin Từ Chối -> Hoàn lại Bánh Mì cho Học Sinh
    if (status === 'rejected' && order.status === 'pending') {
      const updatedStats = await this.prisma.userStats.upsert({
        where: { userId: order.userId },
        update: { totalBanhRan: { increment: order.totalBanh } },
        create: { userId: order.userId, totalBanhRan: order.totalBanh },
      });

      await this.prisma.pointHistory.create({
        data: {
          userId: order.userId,
          points: order.totalBanh,
          reason: `Hoàn lại ${order.totalBanh} Bánh Mì do đơn hàng #${orderId} bị từ chối bởi ${reviewerName}`,
        },
      });

      // Bắn sự kiện cập nhật số dư Bánh Mì hoàn tiền cho học sinh
      this.eventsGateway.sendCurrencyUpdate(order.userId, {
        amount: order.totalBanh,
        newBalance: updatedStats.totalBanhRan,
        reason: `Hoàn tiền đơn đổi quà #${orderId}`,
        studentName: order.studentName,
      });
    }

    const updatedOrder = await this.prisma.marketOrder.update({
      where: { id: orderId },
      data: {
        status,
        reviewedBy: reviewerName,
        reviewedAt: new Date(),
      },
    });

    // Bắn sự kiện Real-time thông báo kết quả duyệt đơn cho học sinh
    this.eventsGateway.sendOrderReviewUpdate(order.userId, {
      orderId: order.id,
      status,
      totalBanh: order.totalBanh,
      reviewerName,
    });

    return updatedOrder;
  }

  async adjustCurrency(dto: AdjustCurrencyDto, adminName: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      include: { profile: true },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }

    const studentName =
      user.profile?.fullName ||
      user.email?.split('@')[0] ||
      `Học viên #${dto.userId}`;

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
        studentName,
        userId: dto.userId,
        userName: adminName,
        userRole: 'ADMIN',
        amount: dto.amount,
        reason: dto.reason,
        type: dto.amount >= 0 ? 'add' : 'subtract',
      },
    });

    // Bắn sự kiện Real-time cập nhật số dư Bánh Mì ngay lập tức cho học sinh
    this.eventsGateway.sendCurrencyUpdate(dto.userId, {
      amount: dto.amount,
      newBalance: updatedStats.totalBanhRan,
      reason: dto.reason,
      studentName,
    });

    return {
      success: true,
      message: `Đã ${dto.amount >= 0 ? 'cộng' : 'trừ'} ${Math.abs(dto.amount)} Bánh Mì cho học viên ${studentName} thành công!`,
      currentBanh: updatedStats.totalBanhRan,
      studentName,
    };
  }
}
