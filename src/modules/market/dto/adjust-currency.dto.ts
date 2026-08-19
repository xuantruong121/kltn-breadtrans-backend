import { IsInt, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustCurrencyDto {
  @ApiProperty({
    example: 1,
    description: 'ID của học viên cần cộng/trừ Bánh Mì',
  })
  @IsInt()
  userId: number;

  @ApiProperty({
    example: 50,
    description: 'Số lượng Bánh Mì (dương là cộng, âm là trừ)',
  })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'Thưởng học sinh xuất sắc tuần 1' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
