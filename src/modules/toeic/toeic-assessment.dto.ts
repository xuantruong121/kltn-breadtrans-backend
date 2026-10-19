import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
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

export class CompleteToeicAssessmentComponentDto {
  @IsOptional()
  @IsInt({ each: true })
  @Min(1, { each: true })
  speakingSubmissionIds?: number[];

  @IsOptional()
  @IsInt({ each: true })
  @Min(1, { each: true })
  writingSubmissionIds?: number[];
}
