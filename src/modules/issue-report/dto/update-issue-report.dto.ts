import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IssueReportStatus } from '@prisma/client';

export class UpdateIssueReportDto {
  @IsOptional()
  @IsEnum(IssueReportStatus)
  status?: IssueReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assignedAdminId?: number;
}
