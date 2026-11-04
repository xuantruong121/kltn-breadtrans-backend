import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PromoCodeSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePromoCodeDto,
  PromoCodeAdminDto,
} from './dto/promo-code-admin.dto';
import { normalizePromoCode } from './promo.logic';

const withUsage = {
  user: { select: { email: true } },
  redemptions: { select: { discountVnd: true } },
} as const;

type PromoWithUsage = Prisma.PromoCodeGetPayload<{
  include: typeof withUsage;
}>;

/** Admin side of promo codes: create, list with usage, switch off. */
@Injectable()
export class PromoCodeAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreatePromoCodeDto,
    adminUserId: number,
  ): Promise<PromoCodeAdminDto> {
    const code = normalizePromoCode(dto.code);
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (validTo && validTo.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Ngày hết hạn đã qua: mã sẽ không dùng được. Chọn hôm nay hoặc một ngày sau.',
      );
    }
    if (validFrom && validTo && validTo <= validFrom) {
      throw new BadRequestException(
        'Ngày hết hạn phải sau ngày bắt đầu của mã.',
      );
    }
    try {
      const row = await this.prisma.promoCode.create({
        data: {
          code,
          percentOff: dto.percentOff,
          validFrom,
          validTo,
          planCodes: [...new Set(dto.planCodes ?? [])],
          maxRedemptions: dto.maxRedemptions ?? null,
          perUserOnce: dto.perUserOnce ?? true,
          source: PromoCodeSource.ADMIN,
          note: dto.note?.trim() || null,
          createdById: adminUserId,
        },
        include: withUsage,
      });
      return this.toDto(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Mã ${code} đã tồn tại.`);
      }
      throw error;
    }
  }

  async list(source?: 'ADMIN' | 'WINBACK'): Promise<PromoCodeAdminDto[]> {
    const rows = await this.prisma.promoCode.findMany({
      where: source ? { source } : {},
      include: withUsage,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.toDto(row));
  }

  async setActive(id: number, active: boolean): Promise<PromoCodeAdminDto> {
    const exists = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Không tìm thấy mã giảm giá.');
    const row = await this.prisma.promoCode.update({
      where: { id },
      data: { active },
      include: withUsage,
    });
    return this.toDto(row);
  }

  private toDto(row: PromoWithUsage): PromoCodeAdminDto {
    return {
      id: row.id,
      code: row.code,
      percentOff: row.percentOff,
      validFrom: row.validFrom,
      validTo: row.validTo,
      planCodes: row.planCodes,
      maxRedemptions: row.maxRedemptions,
      perUserOnce: row.perUserOnce,
      source: row.source,
      ownerEmail: row.user?.email ?? null,
      active: row.active,
      note: row.note,
      redemptions: row.redemptions.length,
      discountGivenVnd: row.redemptions.reduce(
        (sum, r) => sum + r.discountVnd,
        0,
      ),
      createdAt: row.createdAt,
    };
  }
}
