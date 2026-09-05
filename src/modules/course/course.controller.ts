import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
  ParseIntPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CourseService } from './course.service';
import {
  CreateCourseDto,
  UpdateCourseDto,
  ReviewCourseDto,
  CreateClassDto,
  UpdateClassDto,
  CreateLessonDto,
  UpdateLessonDto,
  ReorderLessonsDto,
  CreateMaterialDto,
  UpdateMaterialDto,
} from './dto/course.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role, CourseStatus } from '@prisma/client';

@ApiTags('courses')
@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Post()
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({
    summary:
      'Tạo khóa học mới (TEACHER tạo mặc định DRAFT, ADMIN có thể chỉ định teacher)',
  })
  createCourse(@Body() createCourseDto: CreateCourseDto, @Request() req: any) {
    return this.courseService.createCourse(createCourseDto, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tất cả khóa học' })
  getAllCourses(@Request() req: any, @Query('role') role?: string) {
    const userId = req.user?.id;
    const userRole = role || req.user?.role;
    return this.courseService.getAllCourses(userId, userRole);
  }

  @Get('my-courses')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Lấy danh sách khóa học do mình tạo (Teacher)' })
  getMyCourses(@Request() req: any) {
    return this.courseService.getAllCourses(req.user.id, req.user.role);
  }

  @Get('classes')
  @ApiOperation({
    summary:
      'Lấy danh sách các lớp học của người dùng (Giáo viên hoặc Học sinh)',
  })
  getUserClasses(@Request() req: any) {
    return this.courseService.getUserClasses(req.user.id, req.user.role);
  }

  @Get(':courseId/my-enrollments')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary: 'Lấy trạng thái ghi danh của học viên trong các lớp của khóa học',
  })
  getMyEnrollmentsInCourse(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Request() req: any,
  ) {
    return this.courseService.getMyEnrollmentsInCourse(courseId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết một khóa học' })
  getCourseById(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.courseService.getCourseById(id, req.user?.id, req.user?.role);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({
    summary:
      'Cập nhật khóa học (Teacher cập nhật của mình, Admin cập nhật tất cả)',
  })
  updateCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCourseDto,
    @Request() req: any,
  ) {
    return this.courseService.updateCourse(id, dto, req.user);
  }

  @Post(':id/submit-review')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({
    summary: 'Gửi khóa học để Admin duyệt (DRAFT -> PENDING_REVIEW)',
  })
  submitCourseForReview(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.courseService.submitCourseForReview(id, req.user);
  }

  @Post(':id/revert-to-draft')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({
    summary: 'Chuyển khóa học về Bản nháp (DRAFT) để chỉnh sửa giáo trình',
  })
  revertCourseToDraft(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.courseService.revertCourseToDraft(id, req.user);
  }

  @Post(':id/review')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Admin duyệt hoặc từ chối khóa học (APPROVE -> PUBLISHED, REJECT -> DRAFT)',
  })
  reviewCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewCourseDto,
    @Request() req: any,
  ) {
    return this.courseService.reviewCourse(id, dto.action, req.user);
  }

  @Post(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật trạng thái khóa học (Duyệt/Từ chối)' })
  updateCourseStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: CourseStatus,
  ) {
    return this.courseService.updateCourseStatus(id, status);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({
    summary:
      'Xóa khóa học (Admin xóa tự do, Teacher xóa khóa học draft của mình)',
  })
  deleteCourse(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.courseService.deleteCourse(id, req.user);
  }

  // ================= CLASSES =================

  @Post(':courseId/classes')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({
    summary:
      'Tạo lớp học mới cho khóa học (Bắt buộc Course PUBLISHED, kiểm tra quyền sở hữu)',
  })
  createClass(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateClassDto,
    @Request() req: any,
  ) {
    return this.courseService.createClass(courseId, req.user, dto);
  }

  @Patch('classes/:classId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Cập nhật thông tin lớp học (kiểm tra ownership)' })
  updateClass(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: UpdateClassDto,
    @Request() req: any,
  ) {
    return this.courseService.updateClass(classId, req.user, dto);
  }

  @Delete('classes/:classId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Xóa lớp học (kiểm tra ownership)' })
  deleteClass(
    @Param('classId', ParseIntPipe) classId: number,
    @Request() req: any,
  ) {
    return this.courseService.deleteClass(classId, req.user);
  }

  @Post('classes/:classId/enroll')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Học viên ghi danh vào lớp học (Kiểm tra trạng thái & capacity)',
  })
  enrollInClass(
    @Param('classId', ParseIntPipe) classId: number,
    @Request() req: any,
  ) {
    return this.courseService.enrollInClass(classId, req.user.id);
  }

  @Get('classes/:classId')
  @ApiOperation({ summary: 'Lấy chi tiết lớp học (chứa Lessons và Materials)' })
  getClassById(
    @Param('classId', ParseIntPipe) classId: number,
    @Request() req: any,
  ) {
    return this.courseService.getClassById(
      classId,
      req.user?.id,
      req.user?.role,
    );
  }

  // ================= LESSONS & MATERIALS =================

  @Post(':courseId/lessons')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Tạo bài học mới cho khóa học' })
  createLesson(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateLessonDto,
    @Request() req: any,
  ) {
    return this.courseService.createLesson(courseId, req.user, dto);
  }

  @Patch('lessons/:lessonId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Cập nhật thông tin bài học' })
  updateLesson(
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() dto: UpdateLessonDto,
    @Request() req: any,
  ) {
    return this.courseService.updateLesson(lessonId, req.user, dto);
  }

  @Delete('lessons/:lessonId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Xóa bài học' })
  deleteLesson(
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Request() req: any,
  ) {
    return this.courseService.deleteLesson(lessonId, req.user);
  }

  @Post(':courseId/lessons/reorder')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Sắp xếp thứ tự các bài học trong khóa học' })
  reorderLessons(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: ReorderLessonsDto,
    @Request() req: any,
  ) {
    return this.courseService.reorderLessons(courseId, req.user, dto.lessonIds);
  }

  @Post('lessons/:lessonId/materials')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Thêm tài liệu cho bài học' })
  createMaterial(
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() dto: CreateMaterialDto,
    @Request() req: any,
  ) {
    return this.courseService.createMaterial(lessonId, req.user, dto);
  }

  @Patch('materials/:materialId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Cập nhật tài liệu học tập' })
  updateMaterial(
    @Param('materialId', ParseIntPipe) materialId: number,
    @Body() dto: UpdateMaterialDto,
    @Request() req: any,
  ) {
    return this.courseService.updateMaterial(materialId, req.user, dto);
  }

  @Delete('materials/:materialId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: 'Xóa tài liệu học tập' })
  deleteMaterial(
    @Param('materialId', ParseIntPipe) materialId: number,
    @Request() req: any,
  ) {
    return this.courseService.deleteMaterial(materialId, req.user);
  }
}
