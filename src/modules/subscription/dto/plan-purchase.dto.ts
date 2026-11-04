import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPaymentStatus, PlanPurchaseStatus } from '@prisma/client';
import type { PayosIntentDto } from '../../payment/payos-payment.service';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsPositive,
} from 'class-validator';

export class CreatePlanPurchaseDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  planVersionId!: number;

  @ApiProperty({ example: '3d6f5b8e-4d9d-4c8b-b7e7-4f8fb50bc4f0' })
  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;

  @ApiPropertyOptional({
    example: 'QUAYLAI-7KQ4M2',
    description: 'Promo code; refused with 400 when it does not apply',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  promoCode?: string;
}

export class PromoPreviewQueryDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  planVersionId!: number;

  @ApiProperty({ example: 'QUAYLAI-7KQ4M2' })
  @IsString()
  @MaxLength(40)
  code!: string;
}

export class PromoPreviewDto {
  @ApiProperty({
    description: 'The code applies to this plan for this learner',
  })
  valid!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Why not' })
  message!: string | null;

  @ApiProperty()
  code!: string;

  @ApiPropertyOptional({ nullable: true, type: Number })
  percentOff!: number | null;

  @ApiProperty()
  listPriceVnd!: number;

  @ApiProperty()
  discountVnd!: number;

  @ApiProperty({ description: 'What the learner pays' })
  amountVnd!: number;
}

export class RejectPlanPurchaseDto {
  @ApiProperty({ example: 'Không tìm thấy giao dịch tương ứng.' })
  @IsString()
  @MaxLength(500)
  rejectionReason!: string;
}

export class PlanPurchaseQueryDto {
  @ApiPropertyOptional({ enum: PlanPurchaseStatus })
  @IsOptional()
  @IsEnum(PlanPurchaseStatus)
  status?: PlanPurchaseStatus;

  @ApiPropertyOptional({ example: 'BTP00000001' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class PlanBankInstructionsDto {
  @ApiProperty()
  bin!: string;

  @ApiProperty()
  bankName!: string;

  @ApiProperty()
  accountNumber!: string;

  @ApiProperty()
  accountName!: string;

  @ApiProperty()
  amountVnd!: number;

  @ApiProperty()
  transferCode!: string;

  @ApiProperty()
  vietQrUrl!: string;
}

export class PlanPurchasePaymentDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  transferCode!: string;

  @ApiProperty({ enum: PlanPaymentStatus })
  status!: PlanPaymentStatus;

  @ApiProperty()
  amountVnd!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ nullable: true })
  reportedAt!: Date | null;

  @ApiProperty({ nullable: true })
  confirmedAt!: Date | null;

  @ApiProperty({ nullable: true })
  rejectedAt!: Date | null;

  @ApiProperty({ nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({ nullable: true })
  paymentIntentExpiresAt!: Date | null;

  @ApiProperty({ nullable: true })
  autoMatchUntil!: Date | null;

  @ApiProperty({ nullable: true })
  supersededAt!: Date | null;
}

export class PlanPurchaseResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ description: 'Plan price when bought, before any discount' })
  listPriceVnd!: number;

  @ApiProperty({
    description: 'Promo discount; amountVnd = listPriceVnd - discountVnd',
  })
  discountVnd!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  promoCode!: string | null;

  @ApiProperty()
  planVersionId!: number;

  @ApiProperty()
  planCode!: string;

  @ApiProperty()
  planDisplayName!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ enum: PlanPurchaseStatus })
  status!: PlanPurchaseStatus;

  @ApiProperty()
  amountVnd!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  durationDays!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ type: PlanPurchasePaymentDto })
  payment!: PlanPurchasePaymentDto;

  @ApiPropertyOptional({ type: PlanBankInstructionsDto, nullable: true })
  bankInstructions!: PlanBankInstructionsDto | null;

  @ApiPropertyOptional({ nullable: true })
  payos!: PayosIntentDto | null;

  @ApiProperty()
  isActivePaymentIntent!: boolean;

  @ApiProperty()
  canReplace!: boolean;

  @ApiProperty({ nullable: true })
  supersededAt!: Date | null;

  @ApiProperty({ nullable: true })
  supersededByPurchaseId!: number | null;
}

export class PlanPurchaseAdminDto extends PlanPurchaseResponseDto {
  @ApiProperty()
  userId!: number;

  @ApiProperty()
  userEmail!: string;

  @ApiProperty({ nullable: true })
  confirmedById!: number | null;

  @ApiProperty({ nullable: true })
  rejectedById!: number | null;
}

export class PaginatedPlanPurchasesDto {
  @ApiProperty({ type: [PlanPurchaseAdminDto] })
  items!: PlanPurchaseAdminDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class RenewalPreviewDto {
  @ApiProperty({
    enum: ['NEW', 'RENEW', 'UPGRADE', 'REFUSED'],
    description:
      'NEW: starts now. RENEW: queued after the running plan. UPGRADE: starts now, the running plan ends and its days are converted. REFUSED: cannot be bought now.',
  })
  kind!: 'NEW' | 'RENEW' | 'UPGRADE' | 'REFUSED';

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  startsAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  endsAt!: string | null;

  @ApiProperty({
    description:
      'Days of the running plan converted into the new one (UPGRADE only).',
  })
  convertedDays!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Why the plan cannot be bought now (REFUSED only).',
  })
  message!: string | null;
}
