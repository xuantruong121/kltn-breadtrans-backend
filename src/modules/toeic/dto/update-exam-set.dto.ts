import { IsString, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExamType } from '@prisma/client';

export class UpdateExamSetDto {
  @ApiPropertyOptional({ example: 'TOEIC ETS 2026 Test 1' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Mô tả chi tiết' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: ExamType })
  @IsEnum(ExamType)
  @IsOptional()
  type?: ExamType;

  @ApiPropertyOptional({ example: 'medium' })
  @IsString()
  @IsOptional()
  difficulty?: string;

  @ApiPropertyOptional({ example: 7200 })
  @IsInt()
  @Min(60)
  @IsOptional()
  durationSeconds?: number;
}
