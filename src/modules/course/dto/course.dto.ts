import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsDateString,
  IsEnum,
  Min,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus, ClassStatus } from '@prisma/client';

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

  @ApiPropertyOptional({
    example: 'BEGINNER',
    description: 'BEGINNER | INTERMEDIATE | ADVANCED',
  })
  @IsString()
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'ID của giáo viên phụ trách (Admin có thể gán, Teacher tự động lấy ID của mình)',
  })
  @IsNumber()
  @IsOptional()
  teacherId?: number;
}

export class UpdateCourseDto {
  @ApiPropertyOptional({ example: 'IELTS Mastery V2' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated course description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/new-thumbnail.jpg' })
  @IsString()
  @IsOptional()
  thumbnail?: string;

  @ApiPropertyOptional({ example: 'INTERMEDIATE' })
  @IsString()
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  teacherId?: number;

  @ApiPropertyOptional({ enum: CourseStatus })
  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;
}

export class ReviewCourseDto {
  @ApiProperty({
    example: 'APPROVE',
    description: 'APPROVE | REJECT',
    enum: ['APPROVE', 'REJECT'],
  })
  @IsString()
  @IsNotEmpty()
  action: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ example: 'Cần bổ sung thêm tài liệu trước khi duyệt' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateClassDto {
  @ApiProperty({ example: 'IELTS Intensive - K01' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    example: 41,
    description:
      'ID của giáo viên phụ trách (Admin gán, Teacher tự động lấy ID bản thân)',
  })
  @IsNumber()
  @IsOptional()
  teacherId?: number;

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

  @ApiPropertyOptional({
    example: 30,
    description: 'Sức chứa tối đa của lớp học',
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  capacity?: number;
}

export class UpdateClassDto {
  @ApiPropertyOptional({ example: 'IELTS Intensive - K01 (Updated)' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 42 })
  @IsNumber()
  @IsOptional()
  teacherId?: number;

  @ApiPropertyOptional({ example: '2026-08-05T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-05T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ example: 'https://meet.google.com/new-link' })
  @IsString()
  @IsOptional()
  meetingLink?: string;

  @ApiPropertyOptional({ example: 35 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ enum: ClassStatus })
  @IsEnum(ClassStatus)
  @IsOptional()
  status?: ClassStatus;
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

export class UpdateLessonDto {
  @ApiPropertyOptional({
    example: 'Unit 1: Introduction to IELTS Reading (Updated)',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated overview of IELTS Reading' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({ example: 'https://youtube.com/watch?v=456' })
  @IsString()
  @IsOptional()
  videoUrl?: string;
}

export class ReorderLessonsDto {
  @ApiProperty({
    example: [3, 1, 2],
    description: 'Danh sách ID bài học theo thứ tự mới',
  })
  @IsArray()
  @IsNumber({}, { each: true })
  lessonIds: number[];
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

export class UpdateMaterialDto {
  @ApiPropertyOptional({ example: 'Unit 1 Reading Material (Updated)' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/materials/unit1-v2.pdf',
  })
  @IsString()
  @IsOptional()
  fileUrl?: string;

  @ApiPropertyOptional({ example: 'PDF' })
  @IsString()
  @IsOptional()
  fileType?: string;
}
