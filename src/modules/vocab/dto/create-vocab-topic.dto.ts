import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PracticeLevel } from '@prisma/client';
import { PRACTICE_LEVELS } from '../../subscription/practice-level';

/** A deck's level: one of the four practice levels (owner 2026-11-27). */
export const VOCAB_LEVELS = PRACTICE_LEVELS;

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

  @ApiPropertyOptional({ example: 'INTERMEDIATE', enum: VOCAB_LEVELS })
  @IsIn([...VOCAB_LEVELS])
  @IsOptional()
  level?: PracticeLevel;
}
