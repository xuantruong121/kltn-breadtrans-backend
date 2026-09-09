import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TtsRequestDto {
  @ApiProperty({
    description: 'Văn bản cần đọc (tối đa 500 ký tự)',
    example: 'Good morning, how are you today?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  @ApiProperty({
    description: 'Chất giọng phát âm (US: giọng Mỹ, UK: giọng Anh)',
    enum: ['US', 'UK'],
    example: 'US',
  })
  @IsIn(['US', 'UK'])
  accent: 'US' | 'UK';

  @ApiProperty({
    description:
      'Tốc độ phát âm (0.5: Rất chậm, 0.75: Chậm, 1.0: Chuẩn, 1.25: Nhanh, 1.5: Rất nhanh)',
    enum: [0.5, 0.75, 1, 1.25, 1.5],
    example: 1,
    default: 1,
  })
  @IsNumber()
  @IsIn([0.5, 0.75, 1, 1.25, 1.5])
  rate: number;
}
