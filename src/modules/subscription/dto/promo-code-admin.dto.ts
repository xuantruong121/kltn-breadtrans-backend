import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePromoCodeDto {
  @ApiProperty({
    example: 'TET2027',
    description: 'Letters, digits and dashes; stored upper-case',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{3,30}$/, {
    message: 'Mã gồm 3–30 chữ, số hoặc dấu gạch ngang.',
  })
  code!: string;

  @ApiProperty({ example: 20, minimum: 1, maximum: 90 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  percentOff!: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['PLUS'],
    description: 'Empty or missing = every paid plan',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['PLUS', 'PRO'], { each: true })
  planCodes?: string[];

  @ApiPropertyOptional({ example: 100, description: 'Missing = no limit' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  perUserOnce?: boolean;

  @ApiPropertyOptional({ example: 'Khuyến mãi Tết' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdatePromoCodeDto {
  @ApiProperty({ description: 'false stops the code at once' })
  @IsBoolean()
  active!: boolean;
}

export class PromoCodeAdminDto {
  @ApiProperty() id!: number;
  @ApiProperty() code!: string;
  @ApiProperty() percentOff!: number;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  validFrom!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  validTo!: Date | null;
  @ApiProperty({ type: [String] }) planCodes!: string[];
  @ApiPropertyOptional({ nullable: true, type: Number })
  maxRedemptions!: number | null;
  @ApiProperty() perUserOnce!: boolean;
  @ApiProperty({ enum: ['ADMIN', 'WINBACK'] }) source!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  ownerEmail!: string | null;
  @ApiProperty() active!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ description: 'Completed purchases that used the code' })
  redemptions!: number;
  @ApiProperty({ description: 'Total discount given, VND' })
  discountGivenVnd!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class PromoCodeQueryDto {
  @ApiPropertyOptional({ enum: ['ADMIN', 'WINBACK'] })
  @IsOptional()
  @IsIn(['ADMIN', 'WINBACK'])
  source?: 'ADMIN' | 'WINBACK';
}
