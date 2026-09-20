import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IssueReportArea,
  IssueReportCategory,
  IssueReportImpact,
} from '@prisma/client';

export class CreateIssueReportDto {
  @IsEnum(IssueReportArea)
  area!: IssueReportArea;

  @IsEnum(IssueReportCategory)
  category!: IssueReportCategory;

  @IsOptional()
  @IsEnum(IssueReportImpact)
  impact?: IssueReportImpact;

  @IsString()
  @Length(20, 1500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  questionId?: number;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
