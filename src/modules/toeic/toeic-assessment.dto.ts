import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ToeicAssessmentComponentKind,
  ToeicAssessmentProductFamily,
} from '@prisma/client';

export class CreateToeicAssessmentDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ToeicAssessmentProductFamily)
  productFamily!: ToeicAssessmentProductFamily;
}

export class UpdateToeicAssessmentDto extends PartialType(
  CreateToeicAssessmentDto,
) {}

export class ToeicAssessmentComponentDto {
  @IsEnum(ToeicAssessmentComponentKind)
  kind!: ToeicAssessmentComponentKind;

  @IsInt()
  @Min(1)
  order!: number;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  lrExamSetId?: number;

  @IsOptional()
  @IsString()
  speakingPracticeSetId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  writingSetId?: number;
}

export class SetToeicAssessmentComponentsDto {
  @ValidateNested({ each: true })
  @Type(() => ToeicAssessmentComponentDto)
  components!: ToeicAssessmentComponentDto[];
}

export class StartToeicAssessmentAttemptDto {
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ToeicWritingAnswerDto {
  @IsInt()
  @Min(1)
  quizId!: number;

  @IsString()
  @MaxLength(10000)
  text!: string;
}

export class CompleteToeicAssessmentComponentDto {
  /** What the learner wrote; a task with no text simply stays unanswered. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ToeicWritingAnswerDto)
  writingAnswers?: ToeicWritingAnswerDto[];
}
