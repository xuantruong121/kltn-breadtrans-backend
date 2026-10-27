import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Matches } from 'class-validator';

/** The learner's TOEIC exam date and target score; null clears a field. */
export class ToeicGoalDto {
  @ApiPropertyOptional({ example: '2026-12-20', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Ngày dự thi phải có dạng YYYY-MM-DD',
  })
  examDate?: string | null;

  @ApiPropertyOptional({ example: 750, nullable: true })
  @IsOptional()
  @IsInt({ message: 'Điểm mục tiêu phải là số nguyên' })
  targetScore?: number | null;
}
