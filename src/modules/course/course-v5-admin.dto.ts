import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import {
  CourseLessonExerciseType,
  CourseLessonSectionType,
  CourseLessonStatus,
} from '@prisma/client';
import { COURSE_LEVELS } from './course-level.contract';

export class UpdateV5CourseDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() thumbnail?: string;
  @IsOptional() @IsString() @IsIn([...COURSE_LEVELS]) level?: string;
}

export class CreateV5LessonDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() slug!: string;
  @IsString() @IsNotEmpty() summary!: string;
  @IsArray() learningObjectives!: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) estimatedMinutes?: number;
  @IsOptional() @IsString() difficulty?: string;
  @IsOptional() @IsUrl() coverImage?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
}

export class UpdateV5LessonDto extends PartialType(CreateV5LessonDto) {
  @IsOptional() @IsEnum(CourseLessonStatus) status?: CourseLessonStatus;
}

export class ReorderV5Dto {
  @IsArray() @Type(() => Number) @IsInt({ each: true }) ids!: number[];
}

export class CreateV5SectionDto {
  @IsEnum(CourseLessonSectionType) type!: CourseLessonSectionType;
  @IsString() @IsNotEmpty() heading!: string;
  @IsDefined() content!: unknown;
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
}

export class UpdateV5SectionDto extends PartialType(CreateV5SectionDto) {}

export class CreateV5MediaDto {
  @IsString() @IsNotEmpty() type!: string;
  @IsUrl() url!: string;
  @IsOptional() @IsString() altText?: string;
  @IsOptional() @IsString() provenance?: string;
}

export class CreateV5ExerciseDto {
  @IsString() @IsNotEmpty() slug!: string;
  @IsEnum(CourseLessonExerciseType) type!: CourseLessonExerciseType;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() prompt!: string;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() content?: unknown;
  @IsOptional() rubric?: unknown;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minimumScore?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
}

export class UpdateV5ExerciseDto extends PartialType(CreateV5ExerciseDto) {}

export class CreateV5QuestionDto {
  @IsString() @IsNotEmpty() prompt!: string;
  @IsOptional() options?: unknown;
  @IsDefined() correctAnswer!: unknown;
  @IsString() @IsNotEmpty() explanation!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
}

export class UpdateV5QuestionDto extends PartialType(CreateV5QuestionDto) {}
