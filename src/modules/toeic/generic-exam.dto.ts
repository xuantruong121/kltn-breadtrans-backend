import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

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
