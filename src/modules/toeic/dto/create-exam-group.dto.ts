import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExamGroupDto {
  @ApiProperty({ example: 1, description: 'Part number: 1 to 7' })
  @IsInt()
  @Min(1)
  @Max(7)
  part: number;

  @ApiPropertyOptional({ example: 'US', default: 'US' })
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
