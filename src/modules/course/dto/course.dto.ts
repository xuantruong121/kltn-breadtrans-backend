import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsDateString,
  IsEnum,
  Min,
  IsInt,
  IsArray,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus, ClassStatus } from '@prisma/client';
import type { PayosIntentDto } from '../../payment/payos-payment.service';

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

  @ApiPropertyOptional({
    example: 30,
    description: 'Sức chứa tối đa của lớp học',
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({
    example: 2500000,
    description: 'Học phí lớp học tính theo VNĐ (0 = Miễn phí)',
  })
  @IsInt({ message: 'Học phí phải là số nguyên' })
  @Min(0, { message: 'Học phí không được nhỏ hơn 0' })
  @IsOptional()
  tuitionFeeVnd?: number;
}

export class UpdateClassDto {
  @ApiPropertyOptional({ example: 'IELTS Intensive - K01 (Updated)' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '2026-08-05T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-05T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ example: 35 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({
    example: 2500000,
    description: 'Học phí lớp học tính theo VNĐ (0 = Miễn phí)',
  })
  @IsInt({ message: 'Học phí phải là số nguyên' })
  @Min(0, { message: 'Học phí không được nhỏ hơn 0' })
  @IsOptional()
  tuitionFeeVnd?: number;

  @ApiPropertyOptional({ enum: ClassStatus })
  @IsEnum(ClassStatus)
  @IsOptional()
  status?: ClassStatus;
}

export class EnrollResponseDto {
  @ApiProperty({ example: 101 })
  enrollmentId: number;

  @ApiProperty({ example: 23 })
  classId: number;

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'PENDING_PAYMENT'] })
  status: 'ACTIVE' | 'PENDING_PAYMENT';

  @ApiProperty({ example: 0 })
  tuitionFeeVnd: number;

  @ApiProperty({ example: true })
  accessGranted: boolean;

  @ApiProperty({ example: 'Đăng ký lớp học thành công.' })
  message: string;

  @ApiPropertyOptional({ nullable: true })
  payos?: PayosIntentDto | null;
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
    enum: ['LISTENING', 'SPEAKING', 'READING', 'WRITING'],
  })
  @IsString()
  @IsIn(['LISTENING', 'SPEAKING', 'READING', 'WRITING'])
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
