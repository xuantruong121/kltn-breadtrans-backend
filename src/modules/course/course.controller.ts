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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CourseService } from './course.service';
import {
  CreateCourseDto,
  UpdateCourseDto,
  ReviewCourseDto,
  CreateLessonDto,
  UpdateLessonDto,
  ReorderLessonsDto,
  CreateMaterialDto,
  UpdateMaterialDto,
  CreateCourseActivityDto,
  UpdateCourseActivityDto,
} from './dto/course.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role, CourseStatus } from '@prisma/client';
import { CourseLearningV5Service } from './course-v5.service';
import { SubmitCourseLessonExerciseDto } from './course-v5.dto';

@ApiTags('courses')
@Controller('courses')
export class CourseController {
  constructor(
    private readonly courseService: CourseService,
    private readonly courseLearningV5Service: CourseLearningV5Service,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get(':courseId/learning')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Lộ trình Course Learning 5.0' })
  getCourseLearningOverview(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Request() req: any,
  ) {
    return this.courseLearningV5Service.getOverview(courseId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get(':courseId/learning/lessons/:lessonId')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Nội dung lesson Course Learning 5.0' })
  getCourseLearningLesson(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Request() req: any,
  ) {
    return this.courseLearningV5Service.getLesson(courseId, lessonId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':courseId/learning/lessons/:lessonId/exercises/:exerciseId/submit')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chấm bài tập nội bộ của Course Lesson' })
  submitCourseLearningExercise(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Param('exerciseId', ParseIntPipe) exerciseId: number,
    @Body() dto: SubmitCourseLessonExerciseDto,
    @Request() req: any,
  ) {
    return this.courseLearningV5Service.submitExercise(
      courseId,
      lessonId,
      exerciseId,
      req.user,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Tạo khóa học mới (Admin toàn quyền quản lý nội dung)',
  })
  createCourse(@Body() createCourseDto: CreateCourseDto, @Request() req: any) {
    return this.courseService.createCourse(createCourseDto, req.user);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tất cả khóa học' })
  getAllCourses(@Request() req: any) {
    return this.courseService.getAllCourses(req.user?.id, req.user?.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get('my-courses')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lấy danh sách khóa học hệ thống (Admin)' })
  getMyCourses(@Request() req: any) {
    return this.courseService.getAllCourses(req.user.id, req.user.role);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết một khóa học' })
  getCourseById(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.courseService.getCourseById(id, req.user?.id, req.user?.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':id/start')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Bắt đầu hoặc tiếp tục khóa học tự học' })
  startCourse(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.courseService.startCourse(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get(':id/activities/:activityId/access')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary: 'Kiểm tra quyền mở hoạt động theo lộ trình khóa học',
  })
  getCourseActivityAccess(
    @Param('id', ParseIntPipe) id: number,
    @Param('activityId', ParseIntPipe) activityId: number,
    @Request() req: any,
  ) {
    return this.courseService.getCourseActivityAccess(id, activityId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get(':courseId/lessons/:lessonId')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary: 'Lấy nội dung học tập của một lesson trong khóa học',
  })
  getCourseLesson(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Request() req: any,
  ) {
    return this.courseService.getCourseLesson(courseId, lessonId, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':id/progress')
  @ApiOperation({
    summary: 'Tiến độ khóa học được suy ra từ hoạt động kỹ năng',
  })
  getCourseProgress(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.courseService.getCourseProgress(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Cập nhật khóa học (Admin)',
  })
  updateCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCourseDto,
    @Request() req: any,
  ) {
    return this.courseService.updateCourse(id, dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':id/submit-review')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Gửi khóa học để Admin duyệt (Đã chuyển đổi sang quản lý trực tiếp)',
  })
  submitCourseForReview(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.courseService.submitCourseForReview(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':id/revert-to-draft')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Chuyển khóa học về Bản nháp (DRAFT) để chỉnh sửa giáo trình',
  })
  revertCourseToDraft(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.courseService.revertCourseToDraft(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật trạng thái khóa học (Duyệt/Từ chối)' })
  updateCourseStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: CourseStatus,
  ) {
    return this.courseService.updateCourseStatus(id, status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Xóa khóa học (Admin)',
  })
  deleteCourse(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.courseService.deleteCourse(id, req.user);
  }

  // ================= LESSONS & MATERIALS =================

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':courseId/lessons')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Tạo bài học mới cho khóa học (Admin)' })
  createLesson(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateLessonDto,
    @Request() req: any,
  ) {
    return this.courseService.createLesson(courseId, req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch('lessons/:lessonId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật thông tin bài học (Admin)' })
  updateLesson(
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() dto: UpdateLessonDto,
    @Request() req: any,
  ) {
    return this.courseService.updateLesson(lessonId, req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete('lessons/:lessonId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Xóa bài học (Admin)' })
  deleteLesson(
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Request() req: any,
  ) {
    return this.courseService.deleteLesson(lessonId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':courseId/lessons/reorder')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Sắp xếp thứ tự các bài học trong khóa học (Admin)',
  })
  reorderLessons(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: ReorderLessonsDto,
    @Request() req: any,
  ) {
    return this.courseService.reorderLessons(courseId, req.user, dto.lessonIds);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post('lessons/:lessonId/materials')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Thêm tài liệu cho bài học (Admin)' })
  createMaterial(
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() dto: CreateMaterialDto,
    @Request() req: any,
  ) {
    return this.courseService.createMaterial(lessonId, req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch('materials/:materialId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật tài liệu học tập (Admin)' })
  updateMaterial(
    @Param('materialId', ParseIntPipe) materialId: number,
    @Body() dto: UpdateMaterialDto,
    @Request() req: any,
  ) {
    return this.courseService.updateMaterial(materialId, req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete('materials/:materialId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Xóa tài liệu học tập (Admin)' })
  deleteMaterial(
    @Param('materialId', ParseIntPipe) materialId: number,
    @Request() req: any,
  ) {
    return this.courseService.deleteMaterial(materialId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':courseId/activities')
  @Roles(Role.ADMIN)
  createCourseActivity(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateCourseActivityDto,
    @Request() req: any,
  ) {
    return this.courseService.createCourseActivity(courseId, dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch('activities/:activityId')
  @Roles(Role.ADMIN)
  updateCourseActivity(
    @Param('activityId', ParseIntPipe) activityId: number,
    @Body() dto: UpdateCourseActivityDto,
    @Request() req: any,
  ) {
    return this.courseService.updateCourseActivity(activityId, dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete('activities/:activityId')
  @Roles(Role.ADMIN)
  deleteCourseActivity(
    @Param('activityId', ParseIntPipe) activityId: number,
    @Request() req: any,
  ) {
    return this.courseService.deleteCourseActivity(activityId, req.user);
  }
}
