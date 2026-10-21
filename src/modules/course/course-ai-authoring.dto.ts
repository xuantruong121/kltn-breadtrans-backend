import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsIn,
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

class CourseAiExampleDto {
  @IsString() @IsNotEmpty() text!: string;
  @IsOptional() @IsString() translation?: string;
  @IsOptional() @IsString() explanation?: string;
}

class CourseAiSectionDto {
  @IsEnum(CourseLessonSectionType) type!: CourseLessonSectionType;
  @IsString() @IsNotEmpty() heading!: string;
  @IsString() @IsNotEmpty() content!: string;
  /** Present when the candidate revises an existing Draft section. */
  @IsOptional() @Type(() => Number) @IsInt() sectionId?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  paragraphs?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  bullets?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CourseAiExampleDto)
  examples?: CourseAiExampleDto[];
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
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CourseAiQuestionDto)
  questions!: CourseAiQuestionDto[];
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
  @IsOptional()
  @IsIn([
    'FULL',
    'SECTIONS',
    'GUIDED_PRACTICE',
    'FINAL_CHECK',
    'IMPROVE_SECTIONS',
  ])
  scope?:
    | 'FULL'
    | 'SECTIONS'
    | 'GUIDED_PRACTICE'
    | 'FINAL_CHECK'
    | 'IMPROVE_SECTIONS';
}

export class RefineCourseLessonSectionDto {
  @IsIn(['EXPAND', 'SIMPLIFY', 'ADD_EXAMPLES', 'KEY_POINTS'])
  action!: 'EXPAND' | 'SIMPLIFY' | 'ADD_EXAMPLES' | 'KEY_POINTS';
}

export class ApplyCourseLessonContentDto {
  @Type(() => Number)
  @IsInt()
  candidateCourseId!: number;
  @Type(() => Number)
  @IsInt()
  candidateLessonId!: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CourseAiSectionDto)
  sections?: CourseAiSectionDto[];
  @IsOptional()
  @ValidateNested()
  @Type(() => CourseAiExerciseDto)
  guidedPractice?: CourseAiExerciseDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => CourseAiExerciseDto)
  finalCheck?: CourseAiExerciseDto;
}
