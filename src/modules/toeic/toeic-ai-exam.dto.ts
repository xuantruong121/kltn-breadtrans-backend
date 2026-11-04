import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  CONFIRMATION_METHODS,
  type ConfirmationMethod,
} from './toeic-answer-review.types';

export class CreateToeicAiExamDto {
  @IsString()
  @IsIn(['TOEIC'])
  familyCode = 'TOEIC' as const;

  @IsString()
  @IsIn(['TOEIC_LR', 'TOEIC_SW', 'TOEIC_4_SKILLS'])
  variantCode: 'TOEIC_LR' | 'TOEIC_SW' | 'TOEIC_4_SKILLS' = 'TOEIC_LR';

  @IsString()
  @IsIn(['FULL_EXAM', 'PART'])
  mode: 'FULL_EXAM' | 'PART' = 'FULL_EXAM';

  @ValidateIf((value) => value.mode === 'PART')
  @IsInt()
  @Min(1)
  @Max(7)
  part?: number;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  topic?: string;

  @IsOptional()
  @IsString()
  @IsIn(['easy', 'medium', 'hard'])
  difficulty?: 'easy' | 'medium' | 'hard';
}

export class ConfirmToeicAiReviewDto {
  /**
   * AFTER_VISION / MANUAL_NO_VISION for Part 1 on the Draft;
   * AFTER_DEGRADED_REVIEW / MANUAL_REVIEW for Part 2-7 candidates.
   */
  @ApiProperty({ enum: CONFIRMATION_METHODS })
  @IsString()
  @IsIn([...CONFIRMATION_METHODS])
  method!: ConfirmationMethod;
}

export class RegenerateToeicAiUnitDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  topic?: string;
}
