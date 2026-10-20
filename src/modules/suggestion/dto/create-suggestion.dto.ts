import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SuggestionAttachmentType, SuggestionCategory } from '@prisma/client';

export class SuggestionAttachmentDto {
  @IsEnum(SuggestionAttachmentType)
  type!: SuggestionAttachmentType;

  @IsString()
  @Length(1, 180)
  name!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url!: string;
}

export class CreateSuggestionDto {
  @IsEnum(SuggestionCategory)
  category!: SuggestionCategory;

  @IsString()
  @Length(10, 2000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => SuggestionAttachmentDto)
  attachments?: SuggestionAttachmentDto[];
}
