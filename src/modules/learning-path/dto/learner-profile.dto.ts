import { ApiPropertyOptional } from '@nestjs/swagger';
import { LearningGoal, LearningTrack, PracticeLevel } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateLearnerProfileDto {
  @ApiPropertyOptional({ enum: LearningTrack })
  @IsOptional()
  @IsEnum(LearningTrack)
  track?: LearningTrack;

  @ApiPropertyOptional({ enum: LearningGoal })
  @IsOptional()
  @IsEnum(LearningGoal)
  goal?: LearningGoal;

  @ApiPropertyOptional({ minimum: 5, maximum: 180 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  minutesPerDay?: number;

  @ApiPropertyOptional({ description: 'ISO date, or null to clear' })
  @IsOptional()
  @IsDateString()
  targetDate?: string | null;

  @ApiPropertyOptional({
    enum: PracticeLevel,
    description: 'Tự chọn mức (chỉ khi chưa có mức từ bài kiểm tra đầu vào)',
  })
  @IsOptional()
  @IsEnum(PracticeLevel)
  selfLevel?: PracticeLevel;

  @ApiPropertyOptional({ description: 'true khi học viên hoàn tất onboarding' })
  @IsOptional()
  @IsBoolean()
  onboarded?: boolean;
}
