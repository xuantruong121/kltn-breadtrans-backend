import { ApiPropertyOptional } from '@nestjs/swagger';
import { LearningGoal, PracticeLevel } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateLearnerProfileDto {
  @ApiPropertyOptional({
    example: 'IT_SOFTWARE',
    description:
      'Mã lĩnh vực (GET /learning-tracks). Phải là lĩnh vực đang bật; lĩnh vực học viên đang chọn thì giữ được dù đã tắt.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{1,40}$/)
  track?: string;

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
    description: 'Tự chọn mức (chỉ khi chưa có mức từ bài đánh giá đầu vào)',
  })
  @IsOptional()
  @IsEnum(PracticeLevel)
  selfLevel?: PracticeLevel;

  @ApiPropertyOptional({ description: 'true khi học viên hoàn tất onboarding' })
  @IsOptional()
  @IsBoolean()
  onboarded?: boolean;
}
