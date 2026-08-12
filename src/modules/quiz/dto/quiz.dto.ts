import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsEnum,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuizType } from '@prisma/client';

export class CreateQuizDto {
  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  courseId?: number;

  @ApiProperty({ example: 'Midterm Test' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Testing Unit 1 to 5' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: QuizType, default: QuizType.TOEIC })
  @IsEnum(QuizType)
  @IsOptional()
  type?: QuizType;

  @ApiPropertyOptional({ example: 60, description: 'Time limit in minutes' })
  @IsNumber()
  @IsOptional()
  timeLimit?: number;
}

export class CreateQuestionDto {
  @ApiProperty({ example: 'MULTIPLE_CHOICE' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    example: { text: 'What is 1+1?', options: ['1', '2', '3'], correct: '2' },
  })
  @IsNotEmpty()
  content: any; // JSONB

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;
}

export class AnswerDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  questionId: number;

  @ApiProperty({ example: '2' })
  @IsNotEmpty()
  answer: any;
}

export class SubmitQuizDto {
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  answers: AnswerDto[];
}
