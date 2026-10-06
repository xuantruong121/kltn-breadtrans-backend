import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExerciseDto {
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
    enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'],
  })
  @IsOptional()
  @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
  difficulty?: string;

  @ApiPropertyOptional({
    example: 'IELTS',
    enum: ['IELTS', 'TOEIC', 'GENERAL'],
  })
  @IsOptional()
  @IsIn(['IELTS', 'TOEIC', 'GENERAL'])
  category?: string;
}
