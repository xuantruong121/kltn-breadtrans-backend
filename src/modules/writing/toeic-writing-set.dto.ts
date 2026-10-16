import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TOEIC_WRITING_TASK_KINDS } from './toeic-writing-set.contract';

export class CreateToeicWritingSetDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class UpdateToeicWritingSetDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class CreateToeicWritingSetItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order!: number;

  @IsIn(TOEIC_WRITING_TASK_KINDS)
  taskKind!: (typeof TOEIC_WRITING_TASK_KINDS)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  writingQuizId!: number;
}

export class UpdateToeicWritingSetItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order?: number;

  @IsOptional()
  @IsIn(TOEIC_WRITING_TASK_KINDS)
  taskKind?: (typeof TOEIC_WRITING_TASK_KINDS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  writingQuizId?: number;
}
