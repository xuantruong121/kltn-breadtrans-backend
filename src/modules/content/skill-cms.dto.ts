import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { QuizPublicationStatus } from '@prisma/client';

export class SkillContentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeLimit?: number;

  @IsOptional()
  @IsString()
  passage?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsString()
  accent?: string;

  @IsOptional()
  @IsArray()
  bilingualContent?: unknown[];

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsBoolean()
  isPremiumContent?: boolean;

  @IsOptional()
  @IsEnum(QuizPublicationStatus)
  publicationStatus?: QuizPublicationStatus;

  // Speaking set fields. Kept explicit so the admin UI never sends arbitrary JSON.
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  targetText?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  audioUrl?: string;

  @IsOptional()
  @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
  difficulty?: string;
}

export class SkillQuestionDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class SkillPublishDto {
  @IsEnum(QuizPublicationStatus)
  status!: QuizPublicationStatus;
}
