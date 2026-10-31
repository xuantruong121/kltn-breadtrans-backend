import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';
import { VOCAB_LEVELS } from './create-vocab-topic.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVocabTopicDto {
  @ApiPropertyOptional({ example: 'Contracts & Agreements' })
  @IsString()
  @IsOptional()
  title?: string;

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
