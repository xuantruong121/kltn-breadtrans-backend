import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ClassService } from './class.service';

@ApiTags('Classes')
@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy danh sách các lớp học của người dùng hiện tại',
  })
  getMyClasses(@Request() req: any) {
    return this.classService.getMyClasses(req.user.id, req.user.role);
  }

  @Get('my-classes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy danh sách các lớp học của người dùng hiện tại (Alias)',
  })
  getMyClassesAlias(@Request() req: any) {
    return this.classService.getMyClasses(req.user.id, req.user.role);
  }

  @Get('watch-tracking')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy dữ liệu theo dõi video đã xem' })
  getWatchTracking(@Request() req: any) {
    return this.classService.getWatchTracking(req.user.id);
  }

  @Patch('watch-tracking')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật tiến độ xem video bài học' })
  updateWatchTracking(
    @Request() req: any,
    @Body() body: { videoKey: string; data: any },
  ) {
    return this.classService.updateWatchTracking(
      req.user.id,
      body.videoKey,
      body.data,
    );
  }

  @Post('daily-room')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo hoặc lấy URL phòng học Daily.co qua API' })
  async getOrCreateDailyRoom(
    @Body()
    body: {
      roomName?: string;
      title?: string;
      endTime?: string | Date;
    },
  ) {
    const url = await this.classService.createDailyRoom(
      body.roomName || body.title,
      body.endTime,
    );
    return { url };
  }

  @Post(':classId/sessions')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo buổi học mới (Session)' })
  createSession(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: any,
  ) {
    return this.classService.createSession(classId, dto);
  }

  @Delete('sessions/:sessionId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa buổi học (Session)' })
  deleteSession(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.classService.deleteSession(sessionId);
  }

  @Patch('sessions/:sessionId/finish')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kết thúc buổi học ngay lập tức' })
  finishSession(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Request() req: any,
  ) {
    return this.classService.finishSession(
      sessionId,
      req.user.id,
      req.user.role,
    );
  }

  @Post(':classId/reward-student')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Giáo viên thưởng Bánh Mì cho học sinh trong lớp' })
  rewardStudent(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() body: { studentId: number; amount: number; reason?: string },
    @Request() req: any,
  ) {
    return this.classService.rewardStudentInClass(
      classId,
      body.studentId,
      body.amount,
      body.reason || 'Giáo viên thưởng Bánh Mì',
      req.user.id,
      req.user.role,
    );
  }

  @Get('sessions/:sessionId/attendance')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách điểm danh của một buổi học' })
  getSessionAttendance(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Request() req: any,
  ) {
    return this.classService.getSessionAttendance(
      sessionId,
      req.user.id,
      req.user.role,
    );
  }

  @Post('sessions/:sessionId/attendance')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lưu điểm danh buổi học' })
  saveSessionAttendance(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: { records: Array<{ userId: number; isPresent: boolean }> },
    @Request() req: any,
  ) {
    return this.classService.saveSessionAttendance(
      sessionId,
      req.user.id,
      req.user.role,
      body.records || [],
    );
  }

  @Get(':classId/students-analytics')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy thống kê tiến độ học viên trong lớp' })
  getClassStudentsAnalytics(
    @Param('classId', ParseIntPipe) classId: number,
    @Request() req: any,
  ) {
    return this.classService.getClassStudentsAnalytics(
      classId,
      req.user.id,
      req.user.role,
    );
  }

  @Get(':classId')
  @ApiOperation({
    summary: 'Lấy chi tiết lớp học (Course, Lessons, Sessions, Assignments)',
  })
  getClassDetail(
    @Param('classId', ParseIntPipe) classId: number,
    @Request() req: any,
  ) {
    return this.classService.getClassDetail(
      classId,
      req.user.id,
      req.user.role,
    );
  }
}
