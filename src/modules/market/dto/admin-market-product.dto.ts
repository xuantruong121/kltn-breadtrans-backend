import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
  IsEnum,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarketFulfillmentType } from '@prisma/client';

export class CreateMarketProductDto {
  @ApiProperty({
    description: 'Tên quà tặng',
    example: 'Gấu bông Bánh Mì linh vật',
  })
  @IsString()
  @IsNotEmpty({ message: 'Tên quà tặng không được để trống' })
  name: string;

  @ApiPropertyOptional({
    description: 'Mã slug duy nhất',
    example: 'gift-plush-banh-mi',
  })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiPropertyOptional({ description: 'Mô tả quà tặng' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Danh mục', default: 'GENERAL' })
  @IsString()
  @IsOptional()
  category?: string = 'GENERAL';

  @ApiPropertyOptional({ description: 'Độ hiếm', default: 'COMMON' })
  @IsString()
  @IsOptional()
  rarity?: string = 'COMMON';

  @ApiProperty({
    description: 'Giá đổi bằng Bánh Mì (phải lớn hơn 0)',
    example: 1000,
  })
  @Type(() => Number)
  @IsInt({ message: 'Giá Bánh Mì phải là số nguyên' })
  @Min(1, { message: 'Giá Bánh Mì phải lớn hơn 0' })
  price: number;

  @ApiProperty({ description: 'Số lượng tồn kho', example: 50, default: 0 })
  @Type(() => Number)
  @IsInt({ message: 'Tồn kho phải là số nguyên' })
  @Min(0, { message: 'Tồn kho không được âm' })
  stock: number;

  @ApiPropertyOptional({ description: 'URL ảnh đại diện' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Thứ tự hiển thị', default: 0 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  order?: number = 0;

  @ApiPropertyOptional({ description: 'Trạng thái hiển thị', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;

  @ApiPropertyOptional({
    description: 'Hình thức giao quà (DIGITAL / PHYSICAL)',
    enum: MarketFulfillmentType,
    default: MarketFulfillmentType.DIGITAL,
  })
  @IsEnum(MarketFulfillmentType, {
    message: 'Hình thức giao quà phải là DIGITAL hoặc PHYSICAL',
  })
  @IsOptional()
  fulfillmentType?: MarketFulfillmentType = MarketFulfillmentType.DIGITAL;
}

export class UpdateMarketProductDto {
  @ApiPropertyOptional({ description: 'Tên quà tặng' })
  @IsString()
  @IsNotEmpty({ message: 'Tên quà tặng không được để trống' })
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Mã slug duy nhất' })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiPropertyOptional({ description: 'Mô tả quà tặng' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Danh mục' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Độ hiếm' })
  @IsString()
  @IsOptional()
  rarity?: string;

  @ApiPropertyOptional({ description: 'Giá đổi bằng Bánh Mì (phải lớn hơn 0)' })
  @Type(() => Number)
  @IsInt({ message: 'Giá Bánh Mì phải là số nguyên' })
  @Min(1, { message: 'Giá Bánh Mì phải lớn hơn 0' })
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({ description: 'Số lượng tồn kho' })
  @Type(() => Number)
  @IsInt({ message: 'Tồn kho phải là số nguyên' })
  @Min(0, { message: 'Tồn kho không được âm' })
  @IsOptional()
  stock?: number;

  @ApiPropertyOptional({ description: 'URL ảnh đại diện' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Thứ tự hiển thị' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({ description: 'Trạng thái hiển thị' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Hình thức giao quà (DIGITAL / PHYSICAL)',
    enum: MarketFulfillmentType,
  })
  @IsEnum(MarketFulfillmentType, {
    message: 'Hình thức giao quà phải là DIGITAL hoặc PHYSICAL',
  })
  @IsOptional()
  fulfillmentType?: MarketFulfillmentType;
}

export class AdminMarketProductQueryDto {
  @ApiPropertyOptional({ description: 'Tìm kiếm theo tên hoặc slug' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Trạng thái hoạt động (true, false, all)',
  })
  @IsString()
  @IsOptional()
  isActive?: string;

  @ApiPropertyOptional({ description: 'Lọc theo danh mục' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo hình thức giao',
    enum: MarketFulfillmentType,
  })
  @IsEnum(MarketFulfillmentType)
  @IsOptional()
  fulfillmentType?: MarketFulfillmentType;

  @ApiPropertyOptional({ description: 'Trang hiện tại', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Số bản ghi trên trang', default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 50;
}

export class AdminReviewOrderDto {
  @ApiProperty({
    description: 'Trạng thái duyệt (approved hoặc rejected)',
    enum: ['approved', 'rejected'],
  })
  @IsIn(['approved', 'rejected'], {
    message: 'Trạng thái duyệt phải là approved hoặc rejected',
  })
  status: 'approved' | 'rejected';

  @ApiPropertyOptional({
    description: 'Lý do từ chối (bắt buộc nếu status = rejected)',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}
