import { IsInt, Min, IsOptional, IsString, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateExamQuestionDto {
  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  questionNumber?: number;

  @ApiPropertyOptional({
    example: 'What is the main topic of the conversation?',
  })
  @IsString()
  @IsOptional()
  text?: string;

  @ApiPropertyOptional({
    example: ['Option A', 'Option B', 'Option C', 'Option D'],
  })
  @IsArray()
  @IsOptional()
  options?: string[];

  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  correctIndex?: number;

  @ApiPropertyOptional({ example: 'Chi tiết giải thích...' })
  @IsString()
  @IsOptional()
  explanation?: string;
}
