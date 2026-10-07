import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPaymentStatus, PlanPurchaseStatus } from '@prisma/client';
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

  @ApiProperty({ type: PlanBankInstructionsDto })
  bankInstructions!: PlanBankInstructionsDto;

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
