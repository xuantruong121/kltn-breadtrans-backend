import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

export class ListeningTranscriptSegmentDto {
  @IsString()
  @IsNotEmpty()
  speaker!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  translation?: string;
}

export class ListeningQuestionContentDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  correctAnswer?: string;

  @IsOptional()
  @IsString()
  audioText?: string;

  @IsOptional()
  @IsString()
  speaker?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListeningTranscriptSegmentDto)
  transcriptSegments?: ListeningTranscriptSegmentDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  correctIndex?: number;

  @IsOptional()
  @IsString()
  explanation?: string;
}

export class ListeningQuestionDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['DICTATION', 'DIALOGUE', 'MULTIPLE_CHOICE'])
  type!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => ListeningQuestionContentDto)
  content!: ListeningQuestionContentDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class WritingQuestionDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['WRITING'])
  type!: string;

  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  taskType?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @Min(1, { each: true })
  wordRange?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sampleSentences?: string[];

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class SkillPublishDto {
  @IsEnum(QuizPublicationStatus)
  status!: QuizPublicationStatus;
}

export class SpeakingExerciseDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  targetText!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
  difficulty?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  audioUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPremiumContent?: boolean;
}
