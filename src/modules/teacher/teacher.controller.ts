import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { TeacherService } from './teacher.service';

@ApiTags('Teacher Portal')
@Controller('teacher')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER, Role.ADMIN)
@ApiBearerAuth()
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  @Get('dashboard/overview')
  @ApiOperation({
    summary: 'Lấy 3 số liệu thống kê tổng quan (Học sinh, Buổi dạy, Giờ dạy)',
  })
  getDashboardOverview(@Request() req: any) {
    return this.teacherService.getDashboardOverview(req.user.id);
  }

  @Get('dashboard/upcoming')
  @ApiOperation({
    summary: 'Lấy danh sách các buổi học sắp tới của giảng viên',
  })
  getUpcomingSessions(@Request() req: any, @Query('limit') limit?: string) {
    const take = limit ? parseInt(limit, 10) : 8;
    return this.teacherService.getUpcomingSessions(req.user.id, take);
  }

  @Get('schedule')
  @ApiOperation({
    summary: 'Lấy dữ liệu thời khóa biểu tuần / tháng của giảng viên',
  })
  getSchedule(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.teacherService.getSchedule(req.user.id, startDate, endDate);
  }

  @Patch('sessions/:id/note')
  @ApiOperation({
    summary: 'Cập nhật ghi chú nội dung buổi học (lessonNote)',
  })
  updateSessionNote(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lessonNote: string },
  ) {
    return this.teacherService.updateSessionNote(
      id,
      req.user.id,
      req.user.role,
      body.lessonNote,
    );
  }

  @Post('classes/:classId/sessions')
  @ApiOperation({
    summary: 'Tạo nhanh buổi học mới cho lớp học giáo viên phụ trách',
  })
  createSession(
    @Request() req: any,
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: any,
  ) {
    return this.teacherService.createSession(
      req.user.id,
      req.user.role,
      classId,
      dto,
    );
  }
}
