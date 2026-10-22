import { IsInt, IsNotEmpty, IsString } from 'class-validator';
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
  @IsInt()
  amount: number;

  @ApiProperty({ example: 'Thưởng học sinh xuất sắc tuần 1' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({
    example: 'a3f1c9e2-...-uuid',
    description:
      'UUID do client sinh ra cho MỖI thao tác điều chỉnh (một lần bấm nút = một UUID). ' +
      'Gửi lại đúng UUID này khi retry/double-click để không bị áp dụng 2 lần. ' +
      'Hai điều chỉnh hợp lệ khác nhau phải dùng UUID khác nhau dù amount/reason trùng.',
  })
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
