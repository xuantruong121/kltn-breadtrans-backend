import { IsIn, IsString, IsOptional, IsInt } from 'class-validator';
import type { PracticeLevel } from '@prisma/client';
import { PRACTICE_LEVELS } from '../../subscription/practice-level';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGrammarTopicDto {
  @ApiPropertyOptional({ example: 'Thì Hiện Tại Đơn' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'BASIC', enum: PRACTICE_LEVELS })
  @IsIn([...PRACTICE_LEVELS])
  @IsOptional()
  level?: PracticeLevel;

  @ApiPropertyOptional({ example: 'Mô tả chi tiết' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '10r9ke8Gg3Y' })
  @IsString()
  @IsOptional()
  videoYoutubeId?: string;

  @ApiPropertyOptional({ example: 'S + V(s/es) + O' })
  @IsString()
  @IsOptional()
  keyFormula?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  order?: number;
}
