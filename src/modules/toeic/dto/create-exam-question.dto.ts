import { IsInt, Min, IsOptional, IsString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExamQuestionDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  questionNumber: number;

  @ApiPropertyOptional({
    example: 'What is the main topic of the conversation?',
  })
  @IsString()
  @IsOptional()
  text?: string;

  @ApiProperty({ example: ['Option A', 'Option B', 'Option C', 'Option D'] })
  @IsArray()
  options: string[];

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  correctIndex: number;

  @ApiPropertyOptional({ example: 'Chi tiết giải thích...' })
  @IsString()
  @IsOptional()
  explanation?: string;
}
