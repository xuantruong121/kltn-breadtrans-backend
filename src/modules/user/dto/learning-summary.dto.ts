import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  MAX_SECONDS_PER_REPORT,
  STUDY_SKILLS,
  SUMMARY_PERIODS,
  type StudySkill,
  type SummaryPeriod,
} from '../learning-summary.logic';

/** What a practice room counted since its last report. */
export class StudyTimeDto {
  @ApiProperty({ enum: STUDY_SKILLS, example: 'LISTENING' })
  @IsIn(STUDY_SKILLS)
  skill: StudySkill;

  @ApiProperty({ example: 60, minimum: 1, maximum: MAX_SECONDS_PER_REPORT })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SECONDS_PER_REPORT)
  seconds: number;
}

export class LearningSummaryQueryDto {
  @ApiPropertyOptional({ enum: SUMMARY_PERIODS, default: 'today' })
  @IsOptional()
  @IsIn(SUMMARY_PERIODS)
  period?: SummaryPeriod;

  @ApiPropertyOptional({
    example: '2026-11-20',
    description: 'Ngày bắt đầu (custom)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-26',
    description: 'Ngày kết thúc (custom)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
