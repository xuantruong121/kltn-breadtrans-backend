import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface MarketOrderItem {
  id: string;
  name: string;
  price?: number;
  quantity?: number;
  type?: string;
}

export class CreateMarketOrderDto {
  @ApiProperty({
    example: [
      {
        id: 'streak-freeze',
        name: 'Khiên Bảo Vệ Streak',
        price: 100,
        quantity: 1,
        type: 'streak_freeze',
      },
    ],
  })
  @IsArray()
  items: MarketOrderItem[];

  @ApiProperty({ example: 100 })
  @IsNumber()
  totalBanh: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  totalK?: number;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsOptional()
  studentName?: string;
}
