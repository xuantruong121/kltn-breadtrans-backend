import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { IssueReportService } from './issue-report.service';
import { IssueReportQueryDto } from './dto/issue-report-query.dto';
import { UpdateIssueReportDto } from './dto/update-issue-report.dto';

@ApiTags('admin-issue-reports')
@Controller('admin/issue-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminIssueReportController {
  constructor(private readonly service: IssueReportService) {}

  @Get()
  @ApiOperation({ summary: 'Admin xem hàng đợi báo lỗi' })
  list(@Query() query: IssueReportQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Admin xem chi tiết báo lỗi' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin cập nhật trạng thái và ghi chú xử lý' })
  update(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIssueReportDto,
  ) {
    return this.service.update(id, req.user.id, dto);
  }
}
