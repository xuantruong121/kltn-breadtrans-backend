import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { CreateMarketOrderDto } from './dto/create-order.dto';
import { AdjustCurrencyDto } from './dto/adjust-currency.dto';
import { MarketProductDto } from './dto/market-product.dto';
import { isValidVietnamPhone } from '../../common/utils/vietnam-phone.util';
import { randomUUID } from 'crypto';
import { GamificationService } from '../gamification/gamification.service';

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
    private readonly gamificationService: GamificationService,
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
      fulfillmentType: product.fulfillmentType,
      requiresShippingAddress: product.fulfillmentType === 'PHYSICAL',
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
    return this.prisma.banhTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createOrder(
    userId: number,
    dto: CreateMarketOrderDto,
    idempotencyKey?: string,
  ) {
    const checkoutKey = idempotencyKey?.trim() || randomUUID();
    const existingOrder = await this.prisma.marketOrder.findUnique({
      where: { idempotencyKey: checkoutKey },
    });
    if (existingOrder) {
      if (existingOrder.userId !== userId) {
        throw new BadRequestException('Mã xác nhận đổi quà không hợp lệ');
      }
      return {
        success: true,
        status: existingOrder.status,
        message: 'Yêu cầu đổi quà này đã được ghi nhận.',
        orderId: existingOrder.id,
        totalBanh: existingOrder.totalBanh,
        remainingBanh: existingOrder.balanceAtCheckout ?? 0,
      };
    }
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

    const physicalItems = resolvedItems.filter(
      ({ product }) => product.fulfillmentType === 'PHYSICAL',
    );

    let validatedShippingProfile: any = null;

    if (physicalItems.length > 0) {
      const shippingProfile = await this.prisma.userShippingProfile.findUnique({
        where: { userId },
      });

      const missingFields: string[] = [];
      if (!shippingProfile?.recipientName?.trim())
        missingFields.push('recipientName');
      if (
        !shippingProfile?.phone?.trim() ||
        !isValidVietnamPhone(shippingProfile.phone)
      ) {
        missingFields.push('phone');
      }
      if (!shippingProfile?.provinceCode?.trim())
        missingFields.push('province');
      if (!shippingProfile?.wardCode?.trim()) missingFields.push('ward');
      if (!shippingProfile?.addressLine?.trim())
        missingFields.push('addressLine');

      if (!shippingProfile || missingFields.length > 0) {
        throw new UnprocessableEntityException({
          code: 'SHIPPING_PROFILE_REQUIRED',
          message:
            'Vui lòng hoàn thiện thông tin nhận quà trước khi đổi quà vật lý.',
          missingFields,
        });
      }

      validatedShippingProfile = shippingProfile;
    }

    const hasRealGift = physicalItems.length > 0;
    const initialStatus = hasRealGift ? 'pending' : 'approved';
    const itemNames = resolvedItems
      .map(({ product, quantity }) => `${product.name} (x${quantity})`)
      .join(', ');

    // 2. Bọc toàn bộ luồng trong 1 prisma.$transaction nguyên tử
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`market_order:${checkoutKey}`}))`;

      const duplicate = await tx.marketOrder.findUnique({
        where: { idempotencyKey: checkoutKey },
      });
      if (duplicate) {
        if (duplicate.userId !== userId) {
          throw new BadRequestException('Mã xác nhận đổi quà không hợp lệ');
        }
        return {
          order: duplicate,
          remainingBanh: duplicate.balanceAtCheckout ?? 0,
        };
      }

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

      // 2b. Trừ số dư Bánh Mì qua primitive dùng chung (CAS + ghi ledger
      // MARKET_PURCHASE trong cùng transaction). Reference gắn với checkoutKey
      // (biết trước khi MarketOrder tồn tại) nên cũng là lớp idempotency thứ 2
      // độc lập với unique constraint của MarketOrder.idempotencyKey.
      const deductResult = await this.gamificationService.deductBanh(
        userId,
        calculatedTotalBanh,
        'Đổi quà trong Cửa hàng Bánh Mì',
        'MARKET_PURCHASE',
        `market:order:checkout:${checkoutKey}`,
        { metadata: { itemNames, checkoutKey } },
        tx,
      );

      if (!deductResult.success) {
        throw new BadRequestException(
          `Bạn không đủ Bánh Mì để đổi thưởng (Cần ${calculatedTotalBanh} Bánh Mì, hiện có ${deductResult.newBalance})`,
        );
      }

      const updatedStats = { totalBanhRan: deductResult.newBalance };

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

        // Double-bread boost: activate for 7 days
        if (
          product.slug.includes('double-bread') ||
          product.name.toLowerCase().includes('double bread') ||
          product.name.toLowerCase().includes('bánh x2')
        ) {
          const boostedUntil = new Date();
          boostedUntil.setDate(boostedUntil.getDate() + 7 * quantity);
          await tx.userStats.update({
            where: { userId },
            data: { doubleBanhUntil: boostedUntil },
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
          idempotencyKey: checkoutKey,
        },
      });

      // 2f. Tạo bản ghi MarketPhysicalRedemption (snapshot) cho các món quà vật lý
      if (physicalItems.length > 0 && validatedShippingProfile) {
        const currentShipping =
          (await tx.userShippingProfile.findUnique({
            where: { userId },
          })) || validatedShippingProfile;

        const formattedAddress = `${currentShipping.addressLine}, ${currentShipping.wardName}, ${currentShipping.provinceName}, Việt Nam`;

        for (const { product, quantity } of physicalItems) {
          await tx.marketPhysicalRedemption.create({
            data: {
              userId,
              orderId: order.id,
              productId: product.id,
              productName: product.name,
              quantity,
              status: 'PENDING',
              recipientName: currentShipping.recipientName,
              phone: currentShipping.phone,
              countryCode: currentShipping.countryCode || 'VN',
              provinceCode: currentShipping.provinceCode,
              provinceName: currentShipping.provinceName,
              wardCode: currentShipping.wardCode,
              wardName: currentShipping.wardName,
              addressLine: currentShipping.addressLine,
              formattedAddress,
            },
          });
        }
      }

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
      include: {
        physicalRedemptions: true,
      },
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
        physicalRedemptions: true,
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

        // Hoàn lại Bánh Mì cho học sinh qua primitive dùng chung — reference cố
        // định theo orderId nên refund không thể áp dụng 2 lần (idempotent),
        // độc lập với CAS status ở trên.
        const refundResult = await this.gamificationService.awardBanh(
          order.userId,
          order.totalBanh,
          'MARKET_REFUND',
          `refund:order:${orderId}`,
          { isCapped: false, metadata: { orderId, reviewerName } },
          tx,
        );
        const updatedStats = { totalBanhRan: refundResult.newBalance };

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

        // Cập nhật trạng thái physical redemption sang CANCELLED nếu có
        await tx.marketPhysicalRedemption.updateMany({
          where: { orderId },
          data: { status: 'CANCELLED' },
        });

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

      if (status === 'approved' || status === 'completed') {
        await this.prisma.marketPhysicalRedemption.updateMany({
          where: { orderId, status: 'PENDING' },
          data: { status: status === 'completed' ? 'DELIVERED' : 'PROCESSING' },
        });
      }
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

  /**
   * Compensating action for a redemption that already moved past 'pending'
   * (approved/completed) but whose real-world fulfillment later failed
   * (lost/damaged shipment, discontinued item, etc). Distinct from
   * `reviewOrder`'s pending→rejected path because the semantics differ: this
   * is a post-approval correction, not an initial review decision. CAS-guards
   * the status transition and the Bread refund is idempotent via a stable
   * per-order reference, so retrying this action never double-refunds.
   */
  async markFulfillmentFailed(
    orderId: number,
    reason: string,
    adminName: string,
  ) {
    const order = await this.prisma.marketOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.status !== 'approved' && order.status !== 'completed') {
      throw new BadRequestException(
        `Chỉ có thể đánh dấu thất bại cho đơn đã duyệt/hoàn tất (trạng thái hiện tại: ${order.status})`,
      );
    }

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const casResult = await tx.marketOrder.updateMany({
        where: { id: orderId, status: order.status },
        data: {
          status: 'refunded',
          reviewedBy: adminName,
          reviewedAt: new Date(),
        },
      });
      if (casResult.count === 0) {
        throw new BadRequestException(
          'Đơn hàng đã được xử lý bởi người khác, vui lòng tải lại',
        );
      }

      const refundResult = await this.gamificationService.awardBanh(
        order.userId,
        order.totalBanh,
        'MARKET_REFUND',
        `market:order:${orderId}:fulfillment-failed`,
        {
          isCapped: false,
          metadata: {
            orderId,
            adminName,
            reason,
            reasonType: 'FULFILLMENT_FAILED',
          },
        },
        tx,
      );

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

      await tx.marketPhysicalRedemption.updateMany({
        where: { orderId },
        data: { status: 'CANCELLED' },
      });

      this.eventsGateway.sendCurrencyUpdate(order.userId, {
        amount: order.totalBanh,
        newBalance: refundResult.newBalance,
        reason: `Hoàn tiền do giao/thực hiện thất bại — đơn #${orderId}: ${reason}`,
        studentName: order.studentName,
      });

      return tx.marketOrder.findUnique({ where: { id: orderId } });
    });

    this.eventsGateway.sendOrderReviewUpdate(order.userId, {
      orderId: order.id,
      status: 'refunded',
      totalBanh: order.totalBanh,
      reviewerName: adminName,
    });

    return updatedOrder;
  }

  /**
   * Read-only reconciliation: compares the runtime balance
   * (UserStats.totalBanhRan) against the append-only ledger's sum
   * (SUM(BanhTransaction.amount)) for every user that has either. Never
   * mutates anything — detecting drift is a prerequisite for deciding any
   * remediation, not a repair action.
   */
  async getReconciliationReport() {
    const [allStats, ledgerSums, lastTx, users] = await Promise.all([
      this.prisma.userStats.findMany({
        select: { userId: true, totalBanhRan: true },
      }),
      this.prisma.banhTransaction.groupBy({
        by: ['userId'],
        _sum: { amount: true },
      }),
      this.prisma.banhTransaction.groupBy({
        by: ['userId'],
        _max: { createdAt: true },
      }),
      this.prisma.user.findMany({
        select: { id: true, profile: { select: { fullName: true } } },
      }),
    ]);

    const ledgerByUser = new Map(
      ledgerSums.map((row) => [row.userId, row._sum.amount ?? 0]),
    );
    const lastTxByUser = new Map(
      lastTx.map((row) => [row.userId, row._max.createdAt]),
    );
    const nameByUser = new Map(
      users.map((u) => [u.id, u.profile?.fullName ?? `Học viên #${u.id}`]),
    );
    const userIds = new Set<number>([
      ...allStats.map((s) => s.userId),
      ...ledgerByUser.keys(),
    ]);

    const rows = Array.from(userIds).map((userId) => {
      const storedBalance =
        allStats.find((s) => s.userId === userId)?.totalBanhRan ?? 0;
      const ledgerBalance = ledgerByUser.get(userId) ?? 0;
      const delta = storedBalance - ledgerBalance;
      const status =
        delta === 0
          ? 'CONSISTENT'
          : delta > 0
            ? 'DRIFT_POSITIVE'
            : 'DRIFT_NEGATIVE';
      return {
        userId,
        displayName: nameByUser.get(userId) ?? `Học viên #${userId}`,
        storedBalance,
        ledgerBalance,
        delta,
        status,
        lastTransactionAt: lastTxByUser.get(userId) ?? null,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      totalUsers: rows.length,
      driftCount: rows.filter((r) => r.status !== 'CONSISTENT').length,
      rows,
    };
  }

  /**
   * One-time, explicitly-scoped correction — never applied to "every drifted
   * user" blindly (rule: only reconcile CONFIRMED legacy drift). The caller
   * (Admin, via a reviewed list) passes exactly which userIds to correct.
   * Never touches UserStats.totalBanhRan — only appends the compensating
   * ledger row via GamificationService.appendLegacyReconciliationEntry.
   */
  async runLegacyReconciliation(userIds: number[]) {
    const report = await this.getReconciliationReport();
    const byUserId = new Map(report.rows.map((r) => [r.userId, r]));

    const results = [] as Array<{
      userId: number;
      delta: number;
      applied: boolean;
      alreadyApplied: boolean;
      skippedReason?: string;
    }>;

    for (const userId of userIds) {
      const row = byUserId.get(userId);
      if (!row || row.delta === 0) {
        results.push({
          userId,
          delta: 0,
          applied: false,
          alreadyApplied: false,
          skippedReason: 'Không có chênh lệch tại thời điểm chạy',
        });
        continue;
      }
      const outcome =
        await this.gamificationService.appendLegacyReconciliationEntry(
          userId,
          row.delta,
          'Đối soát dữ liệu Bánh Mì từ dữ liệu khởi tạo cũ',
        );
      results.push({
        userId,
        delta: row.delta,
        applied: outcome.applied,
        alreadyApplied: outcome.alreadyApplied,
      });
    }

    return { results };
  }

  /**
   * Tổng quan cho "Sổ Bánh Mì" — chỉ các con số suy ra thẳng từ ngữ nghĩa
   * ledger (không bịa "doanh thu"): tổng số dư đang lưu hành (UserStats),
   * tổng đã phát hành (tổng các dòng dương), tổng đã sử dụng (trị tuyệt đối
   * tổng các dòng âm).
   */
  async getLedgerSummary() {
    const [balanceSum, issuedSum, spentSum] = await Promise.all([
      this.prisma.userStats.aggregate({ _sum: { totalBanhRan: true } }),
      this.prisma.banhTransaction.aggregate({
        where: { amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.banhTransaction.aggregate({
        where: { amount: { lt: 0 } },
        _sum: { amount: true },
      }),
    ]);
    return {
      totalCurrentBalance: balanceSum._sum.totalBanhRan ?? 0,
      totalIssued: issuedSum._sum.amount ?? 0,
      totalSpent: Math.abs(spentSum._sum.amount ?? 0),
    };
  }

  /**
   * Danh sách giao dịch Bánh Mì thật (BanhTransaction) có filter — nguồn dữ
   * liệu duy nhất cho "Sổ Bánh Mì", không phải CurrencyTransaction (sổ cũ).
   */
  async listLedgerTransactions(filters: {
    userId?: number;
    direction?: 'earning' | 'spending';
    source?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const where: any = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.source) where.source = filters.source;
    if (filters.direction === 'earning') where.amount = { gt: 0 };
    if (filters.direction === 'spending') where.amount = { lt: 0 };
    if (filters.dateFrom || filters.dateTo) {
      where.dateKey = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.banhTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: { id: true, profile: { select: { fullName: true } } },
          },
        },
      }),
      this.prisma.banhTransaction.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Lịch sử Bánh Mì đầy đủ của 1 học viên — luôn đọc từ BanhTransaction
   * (sổ thật), không bao giờ tính từ CurrencyTransaction (sổ cũ).
   */
  async getUserLedgerHistory(userId: number) {
    const [stats, transactions, report] = await Promise.all([
      this.prisma.userStats.findUnique({
        where: { userId },
        select: { totalBanhRan: true },
      }),
      this.prisma.banhTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.getReconciliationReport(),
    ]);
    const reconciliation = report.rows.find((r) => r.userId === userId) ?? {
      storedBalance: stats?.totalBanhRan ?? 0,
      ledgerBalance: 0,
      delta: 0,
      status: 'CONSISTENT',
    };

    return {
      userId,
      currentBalance: stats?.totalBanhRan ?? 0,
      reconciliation,
      transactions,
    };
  }

  async adjustCurrency(dto: AdjustCurrencyDto, adminName: string) {
    if (!Number.isInteger(dto.amount) || dto.amount === 0) {
      throw new BadRequestException(
        'Số lượng điều chỉnh phải là số nguyên khác 0',
      );
    }

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

    // Reference cố định theo idempotencyKey do client sinh — một thao tác
    // Admin (một lần bấm) chỉ áp dụng đúng 1 lần dù bị double-click/retry.
    // Hai điều chỉnh hợp lệ khác nhau (kể cả cùng amount/reason) phải dùng
    // idempotencyKey khác nhau nên không bao giờ bị gộp nhầm.
    const reference = `admin:adjust:${dto.idempotencyKey}`;

    const { newBalance, alreadyApplied } = await this.prisma.$transaction(
      async (tx) => {
        if (dto.amount > 0) {
          const result = await this.gamificationService.awardBanh(
            dto.userId,
            dto.amount,
            'ADMIN_ADJUSTMENT',
            reference,
            { isCapped: false, metadata: { adminName, reason: dto.reason } },
            tx,
          );
          if (result.granted === 0) {
            const stats = await tx.userStats.findUnique({
              where: { userId: dto.userId },
            });
            return {
              newBalance: stats?.totalBanhRan ?? 0,
              alreadyApplied: true,
            };
          }
          return { newBalance: result.newBalance, alreadyApplied: false };
        }

        const result = await this.gamificationService.deductBanh(
          dto.userId,
          Math.abs(dto.amount),
          dto.reason,
          'ADMIN_ADJUSTMENT',
          reference,
          { metadata: { adminName, reason: dto.reason } },
          tx,
        );
        if (!result.success) {
          throw new BadRequestException(
            `Không thể trừ ${Math.abs(dto.amount)} Bánh Mì; số dư hiện tại là ${result.newBalance}`,
          );
        }
        if (result.alreadyApplied) {
          return { newBalance: result.newBalance, alreadyApplied: true };
        }
        return { newBalance: result.newBalance, alreadyApplied: false };
      },
    );

    if (alreadyApplied) {
      return {
        success: true,
        alreadyApplied: true,
        message: `Thao tác điều chỉnh này đã được áp dụng trước đó, không thực hiện lại.`,
        currentBanh: newBalance,
        studentName,
      };
    }

    // PointHistory + CurrencyTransaction (sổ cũ) chỉ ghi khi điều chỉnh thực
    // sự áp dụng lần đầu — tránh double-write trên retry. Giữ nguyên 2 bảng
    // này trong giai đoạn này (dọn CurrencyTransaction là việc tương lai).
    await this.prisma.$transaction(async (tx) => {
      await tx.pointHistory.create({
        data: {
          userId: dto.userId,
          points: dto.amount,
          reason: `[Admin: ${adminName}] ${dto.reason}`,
        },
      });
      await tx.currencyTransaction.create({
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
    });

    // Bắn sự kiện Real-time cập nhật số dư Bánh Mì ngay lập tức cho học sinh
    this.eventsGateway.sendCurrencyUpdate(dto.userId, {
      amount: dto.amount,
      newBalance,
      reason: dto.reason,
      studentName,
    });

    return {
      success: true,
      alreadyApplied: false,
      message: `Đã ${dto.amount >= 0 ? 'cộng' : 'trừ'} ${Math.abs(dto.amount)} Bánh Mì cho học viên ${studentName} thành công!`,
      currentBanh: newBalance,
      studentName,
    };
  }
}
