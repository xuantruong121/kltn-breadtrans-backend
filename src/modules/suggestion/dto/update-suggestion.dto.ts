import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SuggestionStatus } from '@prisma/client';

export class UpdateSuggestionDto {
  @IsOptional()
  @IsEnum(SuggestionStatus)
  status?: SuggestionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminResponse?: string;
}
