import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { CreateMarketOrderDto } from './dto/create-order.dto';
import { AdjustCurrencyDto } from './dto/adjust-currency.dto';
import { MarketProductDto } from './dto/market-product.dto';

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async getProducts(): Promise<MarketProductDto[]> {
    const products = await this.prisma.marketProduct.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });

    return products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description || '',
      category: product.category,
      rarity: product.rarity,
      price: product.price,
      imageUrl:
        product.imageUrl?.startsWith('/') ||
        product.imageUrl?.startsWith('http')
          ? product.imageUrl
          : `/images/market/${product.imageUrl || product.slug}.svg`,
      stock: product.stock,
      available: product.stock > 0 && product.isActive,
      purchaseCount: product.purchaseCount,
      isActive: product.isActive,
    }));
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

    // 1. Server truy vấn giá niêm yết và kiểm tra tồn kho từ database (Read-only, không tự tạo dữ liệu)
    const freshDbProducts = await this.prisma.marketProduct.findMany({
      where: { isActive: true },
    });

    interface ResolvedItem {
      product: (typeof freshDbProducts)[0];
      quantity: number;
    }

    const resolvedItems: ResolvedItem[] = [];
    let calculatedTotalBanh = 0;

    for (const item of rawItems) {
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      let matchedProduct = freshDbProducts.find(
        (p) => p.id === Number(item.id) || p.slug === String(item.id),
      );

      if (!matchedProduct && item.name) {
        matchedProduct = freshDbProducts.find(
          (p) =>
            p.name.toLowerCase().trim() === item.name?.toLowerCase().trim() ||
            p.slug.toLowerCase().trim() === item.name?.toLowerCase().trim(),
        );
      }

      if (!matchedProduct) {
        throw new BadRequestException(
          `Vật phẩm không tồn tại hoặc đã ngừng cung cấp: ${item.name || item.id}`,
        );
      }

      if (matchedProduct.stock < qty) {
        throw new BadRequestException(
          `Sản phẩm "${matchedProduct.name}" không đủ tồn kho (cần ${qty}, còn ${matchedProduct.stock})`,
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

    const hasRealGift = resolvedItems.some(
      ({ product }) => product.category === 'PHYSICAL',
    );

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

        // Tự động trao Huy hiệu nếu mua vật phẩm Huy hiệu
        if (
          product.name.includes('Huy Hiệu') ||
          product.name.includes('Bậc Thầy Từ Vựng')
        ) {
          const badge = await tx.badge.findFirst({
            where: {
              OR: [
                { name: 'Bậc Thầy Từ Vựng' },
                { name: { contains: 'Bậc Thầy' } },
              ],
            },
          });
          if (badge) {
            const existing = await tx.userBadge.findUnique({
              where: { userId_badgeId: { userId, badgeId: badge.id } },
            });
            if (!existing) {
              await tx.userBadge.create({
                data: { userId, badgeId: badge.id },
              });
            }
          }
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

  async getInventory(userId: number) {
    const orders = await this.prisma.marketOrder.findMany({
      where: {
        userId,
        status: { in: ['approved', 'completed'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ownedProductIds: number[] = [];
    const ownedSlugs: string[] = [];
    const ownedItemNames: string[] = [];

    for (const order of orders) {
      const items = Array.isArray(order.items) ? (order.items as any[]) : [];
      for (const item of items) {
        if (
          item.productId &&
          !ownedProductIds.includes(Number(item.productId))
        ) {
          ownedProductIds.push(Number(item.productId));
        }
        if (item.slug && !ownedSlugs.includes(String(item.slug))) {
          ownedSlugs.push(String(item.slug));
        }
        if (item.name && !ownedItemNames.includes(item.name)) {
          ownedItemNames.push(item.name);
        }
      }
    }

    return {
      ownedProductIds,
      ownedSlugs,
      ownedItemNames,
      orders,
    };
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
