import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum AssignmentType {
  ESSAY = 'ESSAY',
  QUIZ = 'QUIZ',
}

export class CreateAssignmentDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ enum: AssignmentType, default: AssignmentType.ESSAY })
  @IsEnum(AssignmentType)
  type: AssignmentType;

  @ApiProperty({
    required: false,
    description: 'Quiz questions if type is QUIZ',
  })
  @IsOptional()
  quizData?: any;
}

export class SubmitAssignmentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  fileUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  quizAnswers?: any;
}

export class GradeAssignmentDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(10)
  grade: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  feedback?: string;
}
