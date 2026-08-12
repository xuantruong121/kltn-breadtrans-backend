import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
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
  createUser(@Body() dto: { email: string; password: string; role: Role; fullName: string; phone?: string }) {
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
}
