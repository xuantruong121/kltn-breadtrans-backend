import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCourseDto {
  @ApiProperty({ example: 'IELTS Mastery' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Complete course for IELTS preparation' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/thumbnail.jpg' })
  @IsString()
  @IsOptional()
  thumbnail?: string;

  @ApiPropertyOptional({ example: 'BEGINNER', description: 'BEGINNER | INTERMEDIATE | ADVANCED' })
  @IsString()
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID của giáo viên phụ trách (Admin gán)' })
  @IsNumber()
  @IsOptional()
  teacherId?: number;
}

export class CreateClassDto {
  @ApiProperty({ example: 'IELTS Intensive - K01' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ example: 'https://meet.google.com/abc-xyz' })
  @IsString()
  @IsOptional()
  meetingLink?: string;
}

export class CreateLessonDto {
  @ApiProperty({ example: 'Unit 1: Introduction to IELTS Reading' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Overview of the IELTS Reading test.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({ example: 'https://youtube.com/watch?v=123' })
  @IsString()
  @IsOptional()
  videoUrl?: string;
}

export class CreateMaterialDto {
  @ApiProperty({ example: 'Unit 1 Reading Material' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'https://example.com/materials/unit1.pdf' })
  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @ApiPropertyOptional({ example: 'PDF' })
  @IsString()
  @IsOptional()
  fileType?: string;
}
