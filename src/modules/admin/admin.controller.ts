import {
  Controller,
  Get,
  Post,
  Patch,
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
import { Role, TopicCategory } from '@prisma/client';
import { CreateUserDto, UpdateUserDto } from './dto/admin-user.dto';
import {
  CreateVocabTopicDto,
  UpdateVocabTopicDto,
  CreateVocabWordDto,
  UpdateVocabWordDto,
  ReorderVocabWordsDto,
} from '../vocab/dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard-stats')
  @ApiOperation({ summary: 'Lay thong ke tong quan cho Admin Dashboard' })
  getDashboardStats(@Query('range') range?: string) {
    return this.adminService.getDashboardStats(range);
  }

  @Get('listening-analytics')
  @ApiOperation({ summary: 'Thống kê thực tế các bài luyện nghe' })
  getListeningAnalytics() {
    return this.adminService.getListeningAnalytics();
  }

  @Get('users')
  @ApiOperation({ summary: 'Lay danh sach tat ca nguoi dung' })
  getAllUsers(@Query('role') role?: string) {
    return this.adminService.getAllUsers(role);
  }

  @Get('users/:id/learning-tracking')
  @ApiOperation({
    summary: 'Admin xem tổng quan học tập của một học viên',
  })
  getLearnerLearningTracking(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getLearnerLearningTracking(id);
  }

  @Post('users')
  @ApiOperation({
    summary: 'Admin tạo tài khoản mới (Học viên hoặc Quản trị viên)',
  })
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Patch('users/:id')
  @ApiOperation({
    summary:
      'Admin cập nhật thông tin người dùng (Họ tên, SĐT, Role, Password)',
  })
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Admin xoa tai khoan nguoi dung' })
  deleteUser(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteUser(id);
  }

  @Post('enroll')
  @ApiOperation({ summary: 'Admin cấp quyền truy cập gói học cho học viên' })
  enrollUser(@Body() dto: { userId: number; classId: number }) {
    return this.adminService.enrollUserInClass(dto.userId, dto.classId);
  }

  @Delete('enroll')
  @ApiOperation({
    summary: 'Admin thu hồi quyền truy cập gói học của học viên',
  })
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
      startDate?: string;
      endDate?: string;
      capacity?: number;
    },
  ) {
    return this.adminService.adminCreateClass(courseId, dto);
  }

  @Post('courses/:courseId/review')
  @ApiOperation({
    summary: 'Admin: Duyet hoac tu choi khoa hoc (APPROVE / REJECT)',
  })
  adminReviewCourse(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: { action: 'APPROVE' | 'REJECT' },
  ) {
    return this.adminService.adminReviewCourse(courseId, dto.action);
  }

  @Get('classes/:classId')
  @ApiOperation({ summary: 'Admin: Chi tiet lop hoc kem danh sach hoc vien' })
  getClassDetail(@Param('classId', ParseIntPipe) classId: number) {
    return this.adminService.getClassWithEnrollments(classId);
  }

  // ============== VOCAB MANAGEMENT (PHASE 4 CMS) ==============
  @Get('vocab/topics')
  @ApiOperation({ summary: 'Admin: Lay danh sach chu de tu vung' })
  getVocabTopics() {
    return this.adminService.getVocabTopics();
  }

  @Get('vocab/topics/:id')
  @ApiOperation({ summary: 'Admin: Chi tiet chu de tu vung kem danh sach tu' })
  getVocabTopicDetail(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getVocabTopicDetail(id);
  }

  @Post('vocab/topics')
  @ApiOperation({ summary: 'Admin: Tao chu de tu vung moi (DRAFT)' })
  createVocabTopic(@Body() dto: CreateVocabTopicDto) {
    return this.adminService.createVocabTopic(dto);
  }

  @Patch('vocab/topics/:id')
  @ApiOperation({ summary: 'Admin: Cap nhat thong tin chu de tu vung' })
  updateVocabTopic(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVocabTopicDto,
  ) {
    return this.adminService.updateVocabTopic(id, dto);
  }

  @Post('vocab/topics/:id/publish')
  @ApiOperation({
    summary: 'Admin: Kiem tra hop le va xuat ban chu de tu vung',
  })
  publishVocabTopic(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.publishVocabTopic(id);
  }

  @Post('vocab/topics/:id/unpublish')
  @ApiOperation({ summary: 'Admin: Go xuat ban (chuyen ve DRAFT)' })
  unpublishVocabTopic(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.unpublishVocabTopic(id);
  }

  @Delete('vocab/topics/:id')
  @ApiOperation({
    summary: 'Admin: Xoa chu de tu vung (bao ve lich su hoc tap)',
  })
  deleteVocabTopic(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteVocabTopic(id);
  }

  @Post('vocab/topics/:id/words')
  @ApiOperation({ summary: 'Admin: Them tu vung vao chu de' })
  addVocabWord(
    @Param('id', ParseIntPipe) topicId: number,
    @Body() dto: CreateVocabWordDto,
  ) {
    return this.adminService.addVocabWord(topicId, dto);
  }

  @Patch('vocab/topics/:topicId/words/:wordId')
  @ApiOperation({ summary: 'Admin: Cap nhat tu vung' })
  updateVocabWord(
    @Param('topicId', ParseIntPipe) topicId: number,
    @Param('wordId', ParseIntPipe) wordId: number,
    @Body() dto: UpdateVocabWordDto,
  ) {
    return this.adminService.updateVocabWord(topicId, wordId, dto);
  }

  @Delete('vocab/topics/:topicId/words/:wordId')
  @ApiOperation({ summary: 'Admin: Xoa tu vung (bao ve lich su hoc tap)' })
  deleteVocabWord(
    @Param('topicId', ParseIntPipe) topicId: number,
    @Param('wordId', ParseIntPipe) wordId: number,
  ) {
    return this.adminService.deleteVocabWord(topicId, wordId);
  }

  @Post('vocab/topics/:id/reorder-words')
  @ApiOperation({ summary: 'Admin: Sap xep thu tu tu vung trong chu de' })
  reorderVocabWords(
    @Param('id', ParseIntPipe) topicId: number,
    @Body() dto: ReorderVocabWordsDto,
  ) {
    return this.adminService.reorderVocabWords(topicId, dto.wordIds);
  }

  // ============== SPEAKING MANAGEMENT ==============
  @Get('speaking/exercises')
  @ApiOperation({ summary: 'Admin: Lay danh sach bai tap phat am' })
  getSpeakingExercises() {
    return this.adminService.getSpeakingExercises();
  }

  @Post('speaking/exercises')
  @ApiOperation({ summary: 'Admin: Tao bai tap phat am moi' })
  createSpeakingExercise(
    @Body()
    dto: {
      title: string;
      targetText: string;
      category?: TopicCategory;
      difficulty?: string;
    },
  ) {
    return this.adminService.createSpeakingExercise(dto);
  }

  @Delete('speaking/exercises/:id')
  @ApiOperation({ summary: 'Admin: Xoa bai tap phat am' })
  deleteSpeakingExercise(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteSpeakingExercise(id);
  }

  // ============== PRACTICE TOPICS MANAGEMENT ==============
  @Get('practice-topics')
  @ApiOperation({ summary: 'Admin: Lay danh sach chu de luyen tap' })
  getPracticeTopics() {
    return this.adminService.getPracticeTopics();
  }

  @Post('practice-topics')
  @ApiOperation({ summary: 'Admin: Tao chu de luyen tap moi' })
  createPracticeTopic(
    @Body()
    dto: {
      name: string;
      vietnameseName?: string;
      category?: TopicCategory;
      iconUrl?: string;
      order?: number;
    },
  ) {
    return this.adminService.createPracticeTopic(dto);
  }

  @Delete('practice-topics/:id')
  @ApiOperation({ summary: 'Admin: Xoa chu de luyen tap' })
  deletePracticeTopic(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deletePracticeTopic(id);
  }

  // ============== CLOUD RESOURCES & COST MANAGEMENT (FINOPS) ==============

  @Get('system-costs')
  @ApiOperation({ summary: 'Lay bao cao tong quan chi phi & tai nguyen Cloud' })
  getSystemCosts() {
    return this.adminService.getSystemCostsOverview();
  }

  @Post('system-costs/purge-ai-cache')
  @ApiOperation({ summary: 'Xoa toan bo cache cua Gemini AI tren Redis' })
  purgeAiCache() {
    return this.adminService.purgeAiCache();
  }

  @Post('system-costs/trigger-r2-cleanup')
  @ApiOperation({
    summary: 'Kich hoat quet & don dep file audio cu hon 90 ngay tren R2',
  })
  triggerR2Cleanup() {
    return this.adminService.triggerR2Cleanup();
  }
}
