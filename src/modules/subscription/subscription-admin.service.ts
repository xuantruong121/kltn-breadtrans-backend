import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  SubscriptionEventType,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminActivePlanDto,
  AdminExtendSubscriptionDto,
  AdminGrantSubscriptionDto,
  AdminLearnerLookupDto,
  AdminRevokeSubscriptionDto,
  AdminSubscriptionEventDto,
  AdminSubscriptionItemDto,
  AdminSubscriptionQueryDto,
  PaginatedAdminSubscriptionsDto,
} from './dto/admin-subscription.dto';

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: {
    user: {
      include: {
        profile: true;
      };
    };
    planVersion: {
      include: {
        plan: true;
      };
    };
  };
}>;

@Injectable()
export class SubscriptionAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly subscriptionInclude = {
    user: {
      include: {
        profile: true,
      },
    },
    planVersion: {
      include: {
        plan: true,
      },
    },
  } as const;

  async listSubscriptions(
    query: AdminSubscriptionQueryDto,
  ): Promise<PaginatedAdminSubscriptionsDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const now = new Date();

    const statusFilter = query.status ?? 'ACTIVE';

    const where: Prisma.SubscriptionWhereInput = {
      planVersion: {
        plan: {
          code: { not: 'FREE' },
        },
      },
    };

    if (search) {
      where.OR = [
        {
          user: {
            email: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          user: {
            profile: {
              fullName: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }

    if (statusFilter === 'ACTIVE') {
      where.status = SubscriptionStatus.ACTIVE;
      where.endsAt = { gt: now };
    } else if (statusFilter === 'EXPIRED') {
      where.OR = [
        { status: SubscriptionStatus.EXPIRED },
        {
          status: SubscriptionStatus.ACTIVE,
          endsAt: { lte: now },
        },
      ];
    } else if (statusFilter === 'REVOKED') {
      where.status = SubscriptionStatus.REVOKED;
    }

    const [total, items] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        include: this.subscriptionInclude,
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: items.map((item) => this.toItemDto(item, now)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async grantSubscription(
    adminId: number,
    dto: AdminGrantSubscriptionDto,
  ): Promise<AdminSubscriptionItemDto> {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Lý do tặng gói không được để trống');
    }

    const idempotencyKey = dto.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existingEvent = await this.prisma.subscriptionEvent.findUnique({
        where: { idempotencyKey },
        include: {
          subscription: {
            include: this.subscriptionInclude,
          },
        },
      });
      if (
        existingEvent &&
        existingEvent.type === SubscriptionEventType.ADMIN_GRANTED
      ) {
        return this.toItemDto(existingEvent.subscription);
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, dto.studentId);

      if (idempotencyKey) {
        const existingEvent = await tx.subscriptionEvent.findUnique({
          where: { idempotencyKey },
          include: {
            subscription: {
              include: this.subscriptionInclude,
            },
          },
        });
        if (
          existingEvent &&
          existingEvent.type === SubscriptionEventType.ADMIN_GRANTED
        ) {
          return existingEvent.subscription;
        }
      }

      const student = await tx.user.findUnique({
        where: { id: dto.studentId },
      });
      if (!student) {
        throw new NotFoundException('Học viên không tồn tại');
      }

      const planVersion = await tx.planVersion.findUnique({
        where: { id: dto.planVersionId },
        include: { plan: true },
      });
      if (!planVersion) {
        throw new NotFoundException('Gói nâng cấp không tồn tại');
      }
      if (planVersion.plan.code === 'FREE') {
        throw new BadRequestException('Không thể tặng gói FREE');
      }

      const now = new Date();
      const activeSubscription = await tx.subscription.findFirst({
        where: {
          userId: dto.studentId,
          status: SubscriptionStatus.ACTIVE,
          endsAt: { gt: now },
          planVersion: { plan: { code: { not: 'FREE' } } },
        },
      });
      if (activeSubscription) {
        throw new ConflictException(
          'Học viên đang có gói hoạt động. Bạn có thể sử dụng chức năng Gia hạn.',
        );
      }

      const durationDays = dto.durationDays || planVersion.durationDays || 30;
      if (durationDays <= 0) {
        throw new BadRequestException('Thời hạn gói phải lớn hơn 0 ngày');
      }

      const startsAt = now;
      const endsAt = new Date(
        startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000,
      );

      const subscription = await tx.subscription.create({
        data: {
          userId: dto.studentId,
          planVersionId: planVersion.id,
          planPurchaseId: null,
          status: SubscriptionStatus.ACTIVE,
          startsAt,
          endsAt,
        },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          type: SubscriptionEventType.ADMIN_GRANTED,
          actorUserId: adminId,
          reason,
          previousEndsAt: null,
          newEndsAt: endsAt,
          idempotencyKey,
          metadata: {
            planCode: planVersion.plan.code,
            planDisplayName: planVersion.plan.displayName,
            version: planVersion.version,
            durationDays,
          },
        },
      });

      return tx.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
        include: this.subscriptionInclude,
      });
    });

    return this.toItemDto(created);
  }

  async extendSubscription(
    adminId: number,
    subscriptionId: number,
    dto: AdminExtendSubscriptionDto,
  ): Promise<AdminSubscriptionItemDto> {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Lý do gia hạn không được để trống');
    }
    if (!dto.extensionDays || dto.extensionDays <= 0) {
      throw new BadRequestException('Số ngày gia hạn phải lớn hơn 0');
    }

    const idempotencyKey = dto.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existingEvent = await this.prisma.subscriptionEvent.findUnique({
        where: { idempotencyKey },
        include: {
          subscription: {
            include: this.subscriptionInclude,
          },
        },
      });
      if (
        existingEvent &&
        existingEvent.type === SubscriptionEventType.ADMIN_EXTENDED
      ) {
        return this.toItemDto(existingEvent.subscription);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: this.subscriptionInclude,
      });
      if (!target) {
        throw new NotFoundException('Quyền học viên không tồn tại');
      }

      await this.lockUser(tx, target.userId);

      if (idempotencyKey) {
        const existingEvent = await tx.subscriptionEvent.findUnique({
          where: { idempotencyKey },
          include: {
            subscription: {
              include: this.subscriptionInclude,
            },
          },
        });
        if (
          existingEvent &&
          existingEvent.type === SubscriptionEventType.ADMIN_EXTENDED
        ) {
          return existingEvent.subscription;
        }
      }

      const fresh = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: this.subscriptionInclude,
      });

      const now = new Date();
      if (fresh.status !== SubscriptionStatus.ACTIVE || fresh.endsAt <= now) {
        throw new ConflictException(
          'Chỉ có thể gia hạn gói đang hoạt động. Với gói đã hết hạn hoặc bị thu hồi, vui lòng sử dụng chức năng Tặng gói mới.',
        );
      }

      const baseDate = new Date(
        Math.max(now.getTime(), fresh.endsAt.getTime()),
      );
      const newEndsAt = new Date(
        baseDate.getTime() + dto.extensionDays * 24 * 60 * 60 * 1000,
      );

      const saved = await tx.subscription.update({
        where: { id: fresh.id },
        data: { endsAt: newEndsAt },
        include: this.subscriptionInclude,
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: fresh.id,
          type: SubscriptionEventType.ADMIN_EXTENDED,
          actorUserId: adminId,
          reason,
          previousEndsAt: fresh.endsAt,
          newEndsAt,
          idempotencyKey,
          metadata: {
            extensionDays: dto.extensionDays,
          },
        },
      });

      return saved;
    });

    return this.toItemDto(updated);
  }

  async revokeSubscription(
    adminId: number,
    subscriptionId: number,
    dto: AdminRevokeSubscriptionDto,
  ): Promise<AdminSubscriptionItemDto> {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Lý do thu hồi quyền không được để trống');
    }

    const idempotencyKey = dto.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existingEvent = await this.prisma.subscriptionEvent.findUnique({
        where: { idempotencyKey },
        include: {
          subscription: {
            include: this.subscriptionInclude,
          },
        },
      });
      if (
        existingEvent &&
        existingEvent.type === SubscriptionEventType.ADMIN_REVOKED
      ) {
        return this.toItemDto(existingEvent.subscription);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: this.subscriptionInclude,
      });
      if (!target) {
        throw new NotFoundException('Quyền học viên không tồn tại');
      }

      await this.lockUser(tx, target.userId);

      if (idempotencyKey) {
        const existingEvent = await tx.subscriptionEvent.findUnique({
          where: { idempotencyKey },
          include: {
            subscription: {
              include: this.subscriptionInclude,
            },
          },
        });
        if (
          existingEvent &&
          existingEvent.type === SubscriptionEventType.ADMIN_REVOKED
        ) {
          return existingEvent.subscription;
        }
      }

      const fresh = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: this.subscriptionInclude,
      });

      if (fresh.status === SubscriptionStatus.REVOKED) {
        return fresh;
      }

      const now = new Date();
      if (fresh.status !== SubscriptionStatus.ACTIVE || fresh.endsAt <= now) {
        throw new ConflictException(
          'Chỉ có thể thu hồi quyền của gói đang hoạt động',
        );
      }

      const saved = await tx.subscription.update({
        where: { id: fresh.id },
        data: { status: SubscriptionStatus.REVOKED },
        include: this.subscriptionInclude,
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: fresh.id,
          type: SubscriptionEventType.ADMIN_REVOKED,
          actorUserId: adminId,
          reason,
          previousEndsAt: fresh.endsAt,
          newEndsAt: fresh.endsAt,
          idempotencyKey,
        },
      });

      return saved;
    });

    return this.toItemDto(updated);
  }

  async getSubscriptionHistory(
    subscriptionId: number,
  ): Promise<AdminSubscriptionEventDto[]> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        planVersion: { include: { plan: true } },
      },
    });
    if (!subscription) {
      throw new NotFoundException('Quyền học viên không tồn tại');
    }

    const events = await this.prisma.subscriptionEvent.findMany({
      where: { subscriptionId },
      include: {
        actor: {
          include: { profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (events.length === 0) {
      const isPaid = subscription.planPurchaseId !== null;
      return [
        {
          id: 0,
          subscriptionId: subscription.id,
          type: isPaid
            ? SubscriptionEventType.PAYMENT_ACTIVATED
            : SubscriptionEventType.ADMIN_GRANTED,
          typeLabel: isPaid ? 'Kích hoạt qua thanh toán' : 'Admin tặng gói',
          actorUserId: null,
          actorName: isPaid ? 'Cổng thanh toán' : 'Quản trị viên',
          actorEmail: null,
          reason: isPaid
            ? 'Kích hoạt từ đơn mua gói hoàn tất'
            : 'Cấp quyền trước khi áp dụng hệ thống audit trail',
          previousEndsAt: null,
          newEndsAt: subscription.endsAt,
          metadata: null,
          createdAt: subscription.createdAt,
        },
      ];
    }

    return events.map((event) => this.toEventDto(event));
  }

  async getLearnerHistory(
    userId: number,
  ): Promise<AdminSubscriptionEventDto[]> {
    const events = await this.prisma.subscriptionEvent.findMany({
      where: {
        subscription: {
          userId,
        },
      },
      include: {
        actor: {
          include: { profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return events.map((event) => this.toEventDto(event));
  }

  async getActivePlans(): Promise<AdminActivePlanDto[]> {
    const versions = await this.prisma.planVersion.findMany({
      where: {
        plan: {
          code: { not: 'FREE' },
          status: 'ACTIVE',
        },
        status: 'PUBLISHED',
        isCurrent: true,
      },
      include: {
        plan: true,
      },
      orderBy: [{ plan: { displayName: 'asc' } }, { version: 'desc' }],
    });

    return versions.map((v) => ({
      id: v.plan.id,
      code: v.plan.code,
      displayName: v.plan.displayName,
      currentVersionId: v.id,
      version: v.version,
      durationDays: v.durationDays,
      priceVnd: v.priceVnd,
    }));
  }

  async searchLearners(query?: string): Promise<AdminLearnerLookupDto[]> {
    const search = query?.trim();
    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
    };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        {
          profile: {
            fullName: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    const now = new Date();
    const users = await this.prisma.user.findMany({
      where,
      include: {
        profile: true,
        subscriptions: {
          where: {
            status: SubscriptionStatus.ACTIVE,
            endsAt: { gt: now },
            planVersion: { plan: { code: { not: 'FREE' } } },
          },
          include: this.subscriptionInclude,
          orderBy: { endsAt: 'desc' },
          take: 1,
        },
      },
      take: 20,
      orderBy: { email: 'asc' },
    });

    return users.map((u) => {
      const activeSub = u.subscriptions[0]
        ? this.toItemDto(u.subscriptions[0], now)
        : null;
      return {
        id: u.id,
        email: u.email,
        fullName: u.profile?.fullName ?? null,
        activeSubscription: activeSub,
      };
    });
  }

  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
    if (rows.length === 0) {
      throw new NotFoundException('Học viên không tồn tại');
    }
  }

  private toItemDto(
    sub: SubscriptionWithRelations,
    now = new Date(),
  ): AdminSubscriptionItemDto {
    let computedStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    if (sub.status === SubscriptionStatus.REVOKED) {
      computedStatus = 'REVOKED';
    } else if (sub.status === SubscriptionStatus.EXPIRED || sub.endsAt <= now) {
      computedStatus = 'EXPIRED';
    } else {
      computedStatus = 'ACTIVE';
    }

    const remainingDays =
      computedStatus === 'ACTIVE'
        ? Math.max(
            0,
            Math.ceil(
              (sub.endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
            ),
          )
        : 0;

    const isPaid = sub.planPurchaseId !== null;
    const source: 'PAYMENT' | 'ADMIN_GRANT' = isPaid
      ? 'PAYMENT'
      : 'ADMIN_GRANT';
    const sourceLabel = isPaid ? 'Thanh toán' : 'Admin tặng';

    return {
      id: sub.id,
      userId: sub.userId,
      userEmail: sub.user.email,
      userFullName: sub.user.profile?.fullName ?? null,
      planId: sub.planVersion.plan.id,
      planCode: sub.planVersion.plan.code,
      planDisplayName: sub.planVersion.plan.displayName,
      planVersionId: sub.planVersion.id,
      version: sub.planVersion.version,
      status: computedStatus,
      startsAt: sub.startsAt,
      endsAt: sub.endsAt,
      remainingDays,
      source,
      sourceLabel,
      planPurchaseId: sub.planPurchaseId,
      createdAt: sub.createdAt,
    };
  }

  private toEventDto(
    event: Prisma.SubscriptionEventGetPayload<{
      include: { actor: { include: { profile: true } } };
    }>,
  ): AdminSubscriptionEventDto {
    const typeLabelMap: Record<SubscriptionEventType, string> = {
      [SubscriptionEventType.PAYMENT_ACTIVATED]: 'Kích hoạt qua thanh toán',
      [SubscriptionEventType.ADMIN_GRANTED]: 'Admin tặng gói',
      [SubscriptionEventType.ADMIN_EXTENDED]: 'Admin gia hạn',
      [SubscriptionEventType.ADMIN_REVOKED]: 'Admin thu hồi quyền',
    };

    const actorName =
      event.actor?.profile?.fullName ||
      event.actor?.email ||
      (event.actorUserId ? `Admin #${event.actorUserId}` : 'Hệ thống');

    return {
      id: event.id,
      subscriptionId: event.subscriptionId,
      type: event.type,
      typeLabel: typeLabelMap[event.type] ?? event.type,
      actorUserId: event.actorUserId,
      actorName,
      actorEmail: event.actor?.email ?? null,
      reason: event.reason,
      previousEndsAt: event.previousEndsAt,
      newEndsAt: event.newEndsAt,
      metadata: (event.metadata as Record<string, any>) ?? null,
      createdAt: event.createdAt,
    };
  }
}
