import {
  ArrayUnique,
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
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { LearningTrack, QuizPublicationStatus } from '@prisma/client';
import {
  SPEAKING_EXERCISE_DIFFICULTIES,
  SPEAKING_TASK_TYPES,
} from '../speaking/speaking-contract';

/** Accepts a string or a plain JSON object (never an array). */
function IsStringOrPlainObject(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isStringOrPlainObject',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} phải là chuỗi hoặc đối tượng.`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' ||
          (!!value && typeof value === 'object' && !Array.isArray(value)),
      },
    });
}

/** Accepts an array or a plain JSON object. */
function IsArrayOrPlainObject(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isArrayOrPlainObject',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} phải là mảng hoặc đối tượng.`,
        ...options,
      },
      validator: {
        validate: (value: unknown) => !!value && typeof value === 'object',
      },
    });
}

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

  /** Reading: paragraph array. Listening: metadata object { mode, levels, accents, ... }. */
  @IsOptional()
  @IsArrayOrPlainObject()
  bilingualContent?: unknown[] | Record<string, unknown>;

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
  @IsIn([...SPEAKING_EXERCISE_DIFFICULTIES])
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

  /** Explicit voice for this speaker (e.g. en-us-female-01). */
  @IsOptional()
  @IsString()
  voiceKey?: string;

  /**
   * Kept so a question that copies the quiz transcript stays identical to it:
   * the audio builder dedupes blocks on speaker, speakerId, voiceKey, text
   * and translation.
   */
  @IsOptional()
  @IsString()
  speakerId?: string;
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

  /** Vietnamese text, or { vi, en, evidence } as published content stores it. */
  @IsOptional()
  @IsStringOrPlainObject()
  explanation?: string | Record<string, unknown>;

  @IsOptional()
  @IsIn(['US', 'UK'])
  accent?: 'US' | 'UK';

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsIn(['LISTENING'])
  skill?: 'LISTENING';

  /** Comprehension: an optional picture the question is about. */
  @IsOptional()
  @IsString()
  imageUrl?: string;
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

export class SkillTracksDto {
  @ApiProperty({
    enum: LearningTrack,
    isArray: true,
    description: 'Toàn bộ ngành của nội dung; thay thế danh sách cũ',
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(LearningTrack, { each: true })
  tracks!: LearningTrack[];
}

export class SkillPublishDto {
  @IsEnum(QuizPublicationStatus)
  status!: QuizPublicationStatus;
}

export class SpeakingExerciseDto {
  @IsOptional()
  @IsIn([...SPEAKING_TASK_TYPES])
  taskType?: string;

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
  @IsIn([...SPEAKING_EXERCISE_DIFFICULTIES])
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

  @IsOptional()
  @IsInt()
  @Min(1)
  stimulusId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;
}

export class SpeakingExerciseReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  exerciseIds!: number[];
}
