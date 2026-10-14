import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateExamGroupDto {
  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(7)
  @IsOptional()
  part?: number;

  @ApiPropertyOptional({ example: 'US' })
  @IsString()
  @IsOptional()
  canonicalAccent?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/audio/group1.mp3' })
  @IsString()
  @IsOptional()
  audioUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/images/part1.png' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'Dear Mr. Smith, ...' })
  @IsString()
  @IsOptional()
  passageText?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @IsOptional()
  groupOrder?: number;
}
