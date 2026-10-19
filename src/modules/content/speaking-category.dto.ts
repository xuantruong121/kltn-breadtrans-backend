import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSpeakingCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9]+(?:[_ -][A-Za-z0-9]+)*$/, {
    message:
      'Mã phân loại chỉ được chứa chữ, số, khoảng trắng, gạch ngang hoặc gạch dưới',
  })
  code?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  allowPracticeSet?: boolean;

  @IsOptional()
  @IsBoolean()
  allowExercise?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSpeakingCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9]+(?:[_ -][A-Za-z0-9]+)*$/, {
    message:
      'Mã phân loại chỉ được chứa chữ, số, khoảng trắng, gạch ngang hoặc gạch dưới',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPracticeSet?: boolean;

  @IsOptional()
  @IsBoolean()
  allowExercise?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
