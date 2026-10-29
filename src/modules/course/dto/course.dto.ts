import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsEnum,
  IsInt,
  IsArray,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import { COURSE_LEVELS } from '../course-level.contract';

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
  @IsIn([...COURSE_LEVELS])
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({ example: 'FOUR_SKILLS' })
  @IsString()
  @IsOptional()
  curriculumType?: string;
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
  @IsIn([...COURSE_LEVELS])
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({ enum: CourseStatus })
  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;

  @ApiPropertyOptional({ example: 'FOUR_SKILLS' })
  @IsString()
  @IsOptional()
  curriculumType?: string;
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

  @ApiPropertyOptional({
    example: 'Nhận biết thông tin chính trong hội thoại.',
  })
  @IsString()
  @IsOptional()
  objective?: string;

  @ApiPropertyOptional({ example: 'Mục tiêu bài học...\nTừ khóa: ...' })
  @IsString()
  @IsOptional()
  contentText?: string;
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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  objective?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contentText?: string;
}

export class CreateCourseActivityDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  lessonId: number;

  @ApiProperty({
    example: 'LISTENING',
    enum: ['LISTENING', 'SPEAKING', 'READING', 'WRITING', 'TOEIC', 'GRAMMAR'],
  })
  @IsString()
  @IsIn(['LISTENING', 'SPEAKING', 'READING', 'WRITING', 'TOEIC', 'GRAMMAR'])
  kind: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isRequired?: boolean;

  @ApiPropertyOptional({ example: 23 })
  @IsInt()
  @IsOptional()
  quizId?: number;

  @ApiPropertyOptional({ example: 'read-aloud-general' })
  @IsString()
  @IsOptional()
  speakingPracticeSetId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  toeicExamId?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  grammarTopicId?: number;

  @ApiPropertyOptional({ example: 'Luyện nghe Unit 1' })
  @IsString()
  @IsOptional()
  title?: string;
}

export class UpdateCourseActivityDto {
  @ApiPropertyOptional({ example: 2 })
  @IsInt()
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;
}
