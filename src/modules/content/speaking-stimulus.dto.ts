import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SpeakingStimulusKind } from '@prisma/client';

export class SpeakingStimulusDto {
  @IsOptional()
  @IsEnum(SpeakingStimulusKind)
  kind?: SpeakingStimulusKind;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
