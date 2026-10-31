import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';

export const VOCAB_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVocabTopicDto {
  @ApiProperty({ example: 'Contracts & Agreements' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: '600 TỪ VỰNG TOEIC' })
  @IsString()
  @IsOptional()
  categoryName?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isPro?: boolean;

  @ApiPropertyOptional({ example: 'https://example.com/icon.png' })
  @IsString()
  @IsOptional()
  iconUrl?: string;
  @ApiPropertyOptional({ example: 'Từ vựng khi họp và trao đổi công việc' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'B1', enum: VOCAB_LEVELS })
  @IsIn(VOCAB_LEVELS)
  @IsOptional()
  level?: string;
}
