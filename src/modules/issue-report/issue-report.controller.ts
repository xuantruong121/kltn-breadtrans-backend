import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateIssueReportDto } from './dto/create-issue-report.dto';
import { IssueReportService } from './issue-report.service';

@ApiTags('issue-reports')
@Controller('issue-reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class IssueReportController {
  constructor(private readonly service: IssueReportService) {}

  @Post()
  @ApiOperation({ summary: 'Học viên gửi báo lỗi nội dung hoặc chức năng' })
  create(
    @Request() req: { user: { id: number } },
    @Body() dto: CreateIssueReportDto,
  ) {
    return this.service.create(req.user.id, dto);
  }
}
