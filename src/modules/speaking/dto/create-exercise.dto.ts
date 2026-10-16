import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SPEAKING_EXERCISE_DIFFICULTIES,
  SPEAKING_TASK_TYPES,
} from '../speaking-contract';

export class CreateExerciseDto {
  @ApiPropertyOptional({ enum: SPEAKING_TASK_TYPES })
  @IsOptional()
  @IsIn([...SPEAKING_TASK_TYPES])
  taskType?: string;

  @ApiProperty({ example: 'IELTS Reading - Sentence Stress' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example:
      'The weather in Vietnam is generally hot and humid throughout the year.',
    description: 'Câu/đoạn văn học viên cần đọc to',
  })
  @IsString()
  @IsNotEmpty()
  targetText: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/speaking/thumb.png',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    example: 'premium/speaking/quiz-1/reference.mp3',
    description:
      'Public URL for free content or a private key for premium content',
  })
  @IsOptional()
  @IsString()
  audioUrl?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPremiumContent?: boolean;

  @ApiPropertyOptional({
    example: 'INTERMEDIATE',
    enum: SPEAKING_EXERCISE_DIFFICULTIES,
  })
  @IsOptional()
  @IsIn([...SPEAKING_EXERCISE_DIFFICULTIES])
  difficulty?: string;

  @ApiPropertyOptional({
    example: 'GENERAL',
    description: 'Speaking category code validated by the taxonomy service',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Reusable shared stimulus ID' })
  @IsOptional()
  @IsInt()
  @Min(1)
  stimulusId?: number | null;
}
