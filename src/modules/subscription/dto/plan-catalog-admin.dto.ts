import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  EntitlementPeriod,
  EntitlementUnit,
  PlanFeatureKey,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsIn,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePlanVersionDto {
  @ApiPropertyOptional({ example: 'Plus monthly' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @ApiPropertyOptional({ example: 'Access to the Plus learning benefits.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 99000, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceVnd?: number;

  @ApiPropertyOptional({ example: 30, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  durationDays?: number;

  @ApiPropertyOptional({ example: 'VND', default: 'VND' })
  @IsOptional()
  @IsString()
  @IsIn(['VND'])
  currency?: string;
}

export class UpdatePlanVersionDto extends PartialType(CreatePlanVersionDto) {}

export class CreatePlanEntitlementDto {
  @ApiProperty({ enum: PlanFeatureKey })
  @IsEnum(PlanFeatureKey)
  featureKey!: PlanFeatureKey;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ example: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limitValue?: number;

  @ApiPropertyOptional({ enum: EntitlementUnit })
  @IsOptional()
  @IsEnum(EntitlementUnit)
  unit?: EntitlementUnit;

  @ApiPropertyOptional({ enum: EntitlementPeriod })
  @IsOptional()
  @IsEnum(EntitlementPeriod)
  period?: EntitlementPeriod;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;
}

export class UpdatePlanEntitlementDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 100, nullable: true, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limitValue?: number | null;

  @ApiPropertyOptional({ enum: EntitlementUnit, nullable: true })
  @IsOptional()
  @IsEnum(EntitlementUnit)
  unit?: EntitlementUnit | null;

  @ApiPropertyOptional({ enum: EntitlementPeriod, nullable: true })
  @IsOptional()
  @IsEnum(EntitlementPeriod)
  period?: EntitlementPeriod | null;

  @ApiPropertyOptional({ type: Object, nullable: true })
  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown> | null;
}

export class PlanEntitlementAdminDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ enum: PlanFeatureKey })
  featureKey!: PlanFeatureKey;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ nullable: true })
  limitValue!: number | null;

  @ApiProperty({ enum: EntitlementUnit, nullable: true })
  unit!: EntitlementUnit | null;

  @ApiProperty({ enum: EntitlementPeriod, nullable: true })
  period!: EntitlementPeriod | null;

  @ApiProperty({ nullable: true, type: Object })
  scope!: Record<string, unknown> | null;
}

export class PlanVersionAdminDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  planId!: number;

  @ApiProperty()
  planCode!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ nullable: true })
  displayName!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  durationDays!: number | null;

  @ApiProperty({ nullable: true })
  priceVnd!: number | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ nullable: true })
  effectiveFrom!: Date | null;

  @ApiProperty({ nullable: true })
  publishedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: [PlanEntitlementAdminDto] })
  entitlements!: PlanEntitlementAdminDto[];
}

export class PlanCatalogAdminDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: [PlanVersionAdminDto] })
  versions!: PlanVersionAdminDto[];
}
