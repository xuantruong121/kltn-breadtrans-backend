import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard-stats')
  @ApiOperation({ summary: 'Lay thong ke tong quan cho Admin Dashboard' })
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('users')
  @ApiOperation({ summary: 'Lay danh sach tat ca nguoi dung' })
  getAllUsers(@Query('role') role?: string) {
    return this.adminService.getAllUsers(role);
  }

  @Post('users')
  @ApiOperation({ summary: 'Admin tao tai khoan moi (Student hoac Teacher)' })
  createUser(
    @Body()
    dto: {
      email: string;
      password: string;
      role: Role;
      fullName: string;
      phone?: string;
    },
  ) {
    return this.adminService.createUser(dto);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Admin xoa tai khoan nguoi dung' })
  deleteUser(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteUser(id);
  }

  @Post('enroll')
  @ApiOperation({ summary: 'Admin ghi danh hoc vien vao lop hoc' })
  enrollUser(@Body() dto: { userId: number; classId: number }) {
    return this.adminService.enrollUserInClass(dto.userId, dto.classId);
  }

  @Delete('enroll')
  @ApiOperation({ summary: 'Admin xoa ghi danh hoc vien khoi lop hoc' })
  removeEnrollment(@Body() dto: { userId: number; classId: number }) {
    return this.adminService.removeEnrollment(dto.userId, dto.classId);
  }

  @Get('classes/:classId/enrollments')
  @ApiOperation({ summary: 'Lay danh sach hoc vien trong mot lop hoc' })
  getEnrollmentsByClass(@Param('classId', ParseIntPipe) classId: number) {
    return this.adminService.getEnrollmentsByClass(classId);
  }

  // ============== COURSE MANAGEMENT ==============

  @Get('courses')
  @ApiOperation({ summary: 'Admin: Lay toan bo danh sach khoa hoc' })
  getAdminCourses() {
    return this.adminService.getAdminCourses();
  }

  @Post('courses')
  @ApiOperation({ summary: 'Admin: Tao khoa hoc moi' })
  adminCreateCourse(
    @Body()
    dto: {
      title: string;
      description?: string;
      thumbnail?: string;
      level?: string;
      teacherId?: number;
    },
  ) {
    return this.adminService.adminCreateCourse(dto);
  }

  @Post('courses/:courseId/update')
  @ApiOperation({ summary: 'Admin: Cap nhat khoa hoc' })
  adminUpdateCourse(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body()
    dto: {
      title?: string;
      description?: string;
      thumbnail?: string;
      level?: string;
      teacherId?: number;
      status?: string;
    },
  ) {
    return this.adminService.adminUpdateCourse(courseId, dto);
  }

  @Delete('courses/:courseId')
  @ApiOperation({ summary: 'Admin: Xoa khoa hoc' })
  adminDeleteCourse(@Param('courseId', ParseIntPipe) courseId: number) {
    return this.adminService.adminDeleteCourse(courseId);
  }

  // ============== CLASS MANAGEMENT ==============

  @Get('classes')
  @ApiOperation({ summary: 'Admin: Lay toan bo danh sach lop hoc' })
  getAllClasses() {
    return this.adminService.getAllClasses();
  }

  @Post('courses/:courseId/classes')
  @ApiOperation({ summary: 'Admin: Tao lop hoc trong khoa hoc' })
  adminCreateClass(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body()
    dto: {
      name: string;
      teacherId: number;
      startDate?: string;
      endDate?: string;
      meetingLink?: string;
    },
  ) {
    return this.adminService.adminCreateClass(courseId, dto);
  }

  @Post('classes/:classId/assign-teacher')
  @ApiOperation({ summary: 'Admin: Phan cong giao vien cho lop hoc' })
  assignTeacher(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: { teacherId: number },
  ) {
    return this.adminService.adminAssignTeacher(classId, dto.teacherId);
  }

  @Get('classes/:classId')
  @ApiOperation({ summary: 'Admin: Chi tiet lop hoc kem danh sach hoc vien' })
  getClassDetail(@Param('classId', ParseIntPipe) classId: number) {
    return this.adminService.getClassWithEnrollments(classId);
  }
}
