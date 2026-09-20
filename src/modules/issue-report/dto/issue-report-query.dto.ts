import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  IssueReportArea,
  IssueReportCategory,
  IssueReportStatus,
} from '@prisma/client';

export class IssueReportQueryDto {
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
  @IsEnum(IssueReportStatus)
  status?: IssueReportStatus;

  @IsOptional()
  @IsEnum(IssueReportArea)
  area?: IssueReportArea;

  @IsOptional()
  @IsEnum(IssueReportCategory)
  category?: IssueReportCategory;

  @IsOptional()
  @IsString()
  search?: string;
}
