import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGenericExamDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  familyCode?: string;

  @IsString()
  @IsOptional()
  family?: string;

  @IsString()
  @IsOptional()
  variantCode?: string;

  @IsString()
  @IsOptional()
  variant?: string;

  // Legacy TOEIC L&R form compatibility during the transition.
  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  difficulty?: string;

  @IsInt()
  @Min(60)
  @IsOptional()
  durationSeconds?: number;
}

export class UpdateGenericExamDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  difficulty?: string;

  @IsInt()
  @Min(60)
  @IsOptional()
  durationSeconds?: number;

  @IsString()
  @IsOptional()
  type?: string;
}

export class ExamWritingSlotDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(5000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
