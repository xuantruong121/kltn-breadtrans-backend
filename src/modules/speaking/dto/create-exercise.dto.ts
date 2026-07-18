import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
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
