import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { SuggestionCategory, SuggestionStatus } from '@prisma/client';

export class SuggestionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(SuggestionStatus)
  status?: SuggestionStatus;

  @IsOptional()
  @IsEnum(SuggestionCategory)
  category?: SuggestionCategory;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest' = 'newest';
}
