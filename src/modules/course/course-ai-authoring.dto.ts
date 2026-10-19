import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CourseLessonExerciseType,
  CourseLessonSectionType,
} from '@prisma/client';

class CourseAiSectionDto {
  @IsEnum(CourseLessonSectionType) type!: CourseLessonSectionType;
  @IsString() @IsNotEmpty() heading!: string;
  @IsString() @IsNotEmpty() content!: string;
}

class CourseAiQuestionDto {
  @IsString() @IsNotEmpty() prompt!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsString() @IsNotEmpty() correctAnswer!: string;
  @IsString() @IsNotEmpty() explanation!: string;
}

class CourseAiExerciseDto {
  @IsEnum(CourseLessonExerciseType) type!: CourseLessonExerciseType;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() prompt!: string;
  @IsOptional() @IsString() instructions?: string;
  @ValidateNested()
  @Type(() => CourseAiQuestionDto)
  question!: CourseAiQuestionDto;
}

class CourseAiLessonDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() summary!: string;
  @IsArray() @IsString({ each: true }) objectives!: string[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseAiSectionDto)
  sections!: CourseAiSectionDto[];
}

export class GenerateCourseCurriculumDto {
  @IsOptional() @IsString() brief?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  lessonCount?: number = 3;
}

export class ApplyCourseCurriculumDto {
  @Type(() => Number)
  @IsInt()
  candidateCourseId!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CourseAiLessonDto)
  lessons!: CourseAiLessonDto[];
}

export class GenerateCourseLessonContentDto {
  @IsOptional() @IsString() brief?: string;
}

export class ApplyCourseLessonContentDto {
  @Type(() => Number)
  @IsInt()
  candidateCourseId!: number;
  @Type(() => Number)
  @IsInt()
  candidateLessonId!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CourseAiSectionDto)
  sections!: CourseAiSectionDto[];
  @ValidateNested()
  @Type(() => CourseAiExerciseDto)
  exercise!: CourseAiExerciseDto;
}
