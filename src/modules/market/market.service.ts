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
    const rawItems = dto.items || [];
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new BadRequestException('Giỏ hàng đổi quà trống');
    }

    // 1. Server tự truy vấn giá niêm yết và kiểm tra tồn kho từ database (KHÔNG tin giá từ client)
    const dbProducts = await this.prisma.marketProduct.findMany();
    if (dbProducts.length === 0) {
      await this.getProducts(); // Tự khởi tạo sản phẩm mặc định nếu bảng trống
    }
    const freshDbProducts = await this.prisma.marketProduct.findMany();

    interface ResolvedItem {
      product: (typeof freshDbProducts)[0];
      quantity: number;
    }

    const resolvedItems: ResolvedItem[] = [];
    let calculatedTotalBanh = 0;

    for (const item of rawItems) {
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      let matchedProduct = freshDbProducts.find(
        (p) => p.id === Number(item.id),
      );

      if (!matchedProduct && item.name) {
        matchedProduct = freshDbProducts.find(
          (p) =>
            p.name.toLowerCase().trim() === item.name?.toLowerCase().trim(),
        );
      }

      if (!matchedProduct && typeof item.id === 'string') {
        const lowerId = item.id.toLowerCase();
        matchedProduct = freshDbProducts.find((p) => {
          const lowerName = p.name.toLowerCase();
          if (lowerId.includes('streak') && lowerName.includes('khiên'))
            return true;
          if (lowerId.includes('bread') && lowerName.includes('nhân đôi'))
            return true;
          if (lowerId.includes('master') && lowerName.includes('từ vựng'))
            return true;
          if (lowerId.includes('crown') && lowerName.includes('vương miện'))
            return true;
          if (lowerId.includes('notebook') && lowerName.includes('sổ tay'))
            return true;
          if (lowerId.includes('tea') || lowerId.includes('voucher'))
            return lowerName.includes('voucher');
          return false;
        });
      }

      if (!matchedProduct) {
        throw new BadRequestException(
          `Vật phẩm không tồn tại trong hệ thống: ${item.name || item.id}`,
        );
      }

      resolvedItems.push({
        product: matchedProduct,
        quantity: qty,
      });

      calculatedTotalBanh += matchedProduct.price * qty;
    }

    if (calculatedTotalBanh <= 0) {
      throw new BadRequestException('Tổng giá trị Bánh Mì không hợp lệ');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
    });

    const hasRealGift = resolvedItems.some(({ product }) => {
      const name = product.name || '';
      return (
        name.includes('Voucher') ||
        name.includes('Sổ Tay') ||
        name.includes('Quà')
      );
    });

    const initialStatus = hasRealGift ? 'pending' : 'approved';
    const itemNames = resolvedItems
      .map(({ product, quantity }) => `${product.name} (x${quantity})`)
      .join(', ');

    // 2. Bọc toàn bộ luồng trong 1 prisma.$transaction nguyên tử
    const result = await this.prisma.$transaction(async (tx) => {
      // 2a. Trừ tồn kho Stock theo CAS nguyên tử
      for (const { product, quantity } of resolvedItems) {
        const stockResult = await tx.marketProduct.updateMany({
          where: {
            id: product.id,
            stock: { gte: quantity },
          },
          data: {
            stock: { decrement: quantity },
            purchaseCount: { increment: quantity },
          },
        });

        if (stockResult.count === 0) {
          throw new BadRequestException(
            `Sản phẩm "${product.name}" đã hết hàng hoặc không đủ tồn kho (cần ${quantity})`,
          );
        }
      }

      // 2b. Trừ số dư Bánh Mì của học sinh theo CAS nguyên tử
      const walletResult = await tx.userStats.updateMany({
        where: {
          userId,
          totalBanhRan: { gte: calculatedTotalBanh },
        },
        data: {
          totalBanhRan: { decrement: calculatedTotalBanh },
        },
      });

      if (walletResult.count === 0) {
        const currentStats = await tx.userStats.findUnique({
          where: { userId },
        });
        throw new BadRequestException(
          `Bạn không đủ Bánh Mì để đổi thưởng (Cần ${calculatedTotalBanh} Bánh Mì, hiện có ${currentStats?.totalBanhRan || 0})`,
        );
      }

      // 2c. Ghi nhận lịch sử trừ điểm
      await tx.pointHistory.create({
        data: {
          userId,
          points: -calculatedTotalBanh,
          reason: `Đổi vật phẩm cửa hàng: ${itemNames}`,
        },
      });

      // 2d. Kích hoạt hiệu ứng vật phẩm nếu là vật phẩm tức thì (Ví dụ Khiên chuỗi)
      for (const { product, quantity } of resolvedItems) {
        if (
          product.name.includes('Khiên') ||
          product.name.toLowerCase().includes('streak')
        ) {
          await tx.userStats.update({
            where: { userId },
            data: { streakFreezes: { increment: quantity } },
          });
        }
      }

      const updatedStats = await tx.userStats.findUnique({ where: { userId } });

      // 2e. Tạo bản ghi đơn hàng MarketOrder
      const orderItems = resolvedItems.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
      }));

      const order = await tx.marketOrder.create({
        data: {
          userId,
          studentName: dto.studentName || profile?.fullName || 'Học viên',
          items: orderItems as any,
          totalK: dto.totalK || 0,
          totalBanh: calculatedTotalBanh,
          status: initialStatus,
          paidAtCheckout: true,
          balanceAtCheckout: updatedStats?.totalBanhRan ?? 0,
        },
      });

      return {
        order,
        remainingBanh: updatedStats?.totalBanhRan ?? 0,
      };
    });

    return {
      success: true,
      status: initialStatus,
      message: hasRealGift
        ? 'Yêu cầu đổi quà đã được gửi tới Ban Quản Trị! Vui lòng chờ phê duyệt nhé 🎁'
        : 'Đổi vật phẩm thành công!',
      orderId: result.order.id,
      totalBanh: calculatedTotalBanh,
      remainingBanh: result.remainingBanh,
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

    let updatedOrder = order;

    // Nếu Admin Từ Chối -> Hoàn lại Bánh Mì và Tồn kho Stock trong cùng 1 transaction nguyên tử
    if (status === 'rejected' && order.status === 'pending') {
      await this.prisma.$transaction(async (tx) => {
        // Atomic CAS đổi trạng thái đơn hàng
        const casResult = await tx.marketOrder.updateMany({
          where: { id: orderId, status: 'pending' },
          data: {
            status: 'rejected',
            reviewedBy: reviewerName,
            reviewedAt: new Date(),
          },
        });

        if (casResult.count === 0) {
          throw new BadRequestException(
            'Đơn hàng đã được duyệt hoặc xử lý bởi người khác',
          );
        }

        // Hoàn lại Bánh Mì cho học sinh
        const updatedStats = await tx.userStats.upsert({
          where: { userId: order.userId },
          update: { totalBanhRan: { increment: order.totalBanh } },
          create: { userId: order.userId, totalBanhRan: order.totalBanh },
        });

        await tx.pointHistory.create({
          data: {
            userId: order.userId,
            points: order.totalBanh,
            reason: `Hoàn lại ${order.totalBanh} Bánh Mì do đơn hàng #${orderId} bị từ chối bởi ${reviewerName}`,
          },
        });

        // Hoàn lại tồn kho stock cho các sản phẩm trong đơn hàng
        const orderItems = (order.items as any[]) || [];
        for (const item of orderItems) {
          const qty = Number(item.quantity) || 1;
          const targetId = Number(item.productId || item.id);
          if (Number.isInteger(targetId)) {
            await tx.marketProduct.updateMany({
              where: { id: targetId },
              data: {
                stock: { increment: qty },
                purchaseCount: { decrement: qty },
              },
            });
          }
        }

        // Bắn sự kiện cập nhật số dư Bánh Mì hoàn tiền cho học sinh
        this.eventsGateway.sendCurrencyUpdate(order.userId, {
          amount: order.totalBanh,
          newBalance: updatedStats.totalBanhRan,
          reason: `Hoàn tiền đơn đổi quà #${orderId}`,
          studentName: order.studentName,
        });
      });

      updatedOrder = (await this.prisma.marketOrder.findUnique({
        where: { id: orderId },
      }))!;
    } else {
      updatedOrder = await this.prisma.marketOrder.update({
        where: { id: orderId },
        data: {
          status,
          reviewedBy: reviewerName,
          reviewedAt: new Date(),
        },
      });
    }

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
