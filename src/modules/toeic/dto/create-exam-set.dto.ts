import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExamType } from '@prisma/client';

export class CreateExamSetDto {
  @ApiProperty({ example: 'TOEIC ETS 2026 Test 1' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({
    example: 'Đề thi thử TOEIC chuẩn format ETS 2 kỹ năng',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: ExamType, default: ExamType.FULL_TEST })
  @IsEnum(ExamType)
  @IsOptional()
  type?: ExamType;

  @ApiPropertyOptional({ example: 'medium', default: 'medium' })
  @IsString()
  @IsOptional()
  difficulty?: string;

  @ApiPropertyOptional({ example: 7200, default: 7200 })
  @IsInt()
  @Min(60)
  @IsOptional()
  durationSeconds?: number;
}
