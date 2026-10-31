import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitGateDto {
  @ApiProperty({
    description: 'Mã câu hỏi -> nội dung phương án đã chọn',
    example: { '12': 'For a staff meeting' },
  })
  @IsObject()
  answers: Record<string, string>;
}
