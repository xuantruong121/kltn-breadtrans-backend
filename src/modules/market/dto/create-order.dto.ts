import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface MarketOrderItem {
  id: string | number;
  name?: string;
  price?: number;
  quantity?: number;
  type?: string;
  category?: string;
}

export class CreateMarketOrderDto {
  @ApiProperty({
    example: [
      {
        id: 'streak-freeze',
        name: 'Khiên Bảo Vệ Streak',
        quantity: 1,
        type: 'streak_freeze',
      },
    ],
  })
  @IsArray()
  items: MarketOrderItem[];

  @ApiPropertyOptional({ example: 100 })
  @IsNumber()
  @IsOptional()
  totalBanh?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  totalK?: number;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsOptional()
  studentName?: string;
}
