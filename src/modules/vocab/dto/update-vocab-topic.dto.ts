import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVocabTopicDto {
  @ApiPropertyOptional({ example: 'Contracts & Agreements' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: '600 TỪ VỰNG TOEIC' })
  @IsString()
  @IsOptional()
  categoryName?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isPro?: boolean;

  @ApiPropertyOptional({ example: 'https://example.com/icon.png' })
  @IsString()
  @IsOptional()
  iconUrl?: string;
}
