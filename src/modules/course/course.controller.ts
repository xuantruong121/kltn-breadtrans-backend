import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { CourseService } from './course.service';
import {
  CreateCourseDto,
  CreateClassDto,
  CreateLessonDto,
  CreateMaterialDto,
} from './dto/course.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('courses')
@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Post()
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo khóa học mới (chỉ ADMIN/TEACHER)' })
  createCourse(@Body() createCourseDto: CreateCourseDto) {
    return this.courseService.createCourse(createCourseDto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tất cả khóa học' })
  getAllCourses() {
    return this.courseService.getAllCourses();
  }

  @Get('my-courses')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách khóa học do mình tạo (Teacher)' })
  getMyCourses(@Request() req: any) {
    return this.courseService.getAllCourses(req.user.id, req.user.role);
  }

  @Get('classes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách các lớp học của người dùng (Giáo viên hoặc Học sinh)' })
  getUserClasses(@Request() req: any) {
    return this.courseService.getUserClasses(req.user.id, req.user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết một khóa học' })
  getCourseById(@Param('id', ParseIntPipe) id: number) {
    return this.courseService.getCourseById(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa khóa học (chỉ ADMIN)' })
  deleteCourse(@Param('id', ParseIntPipe) id: number) {
    return this.courseService.deleteCourse(id);
  }

  @Post(':id/status')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật trạng thái khóa học (Duyệt/Từ chối)' })
  updateCourseStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: any,
  ) {
    return this.courseService.updateCourseStatus(id, status);
  }

  @Post(':courseId/classes')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tạo lớp học mới cho khóa học (TEACHER tự gán mình vào lớp)',
  })
  createClass(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateClassDto,
    @Request() req: any,
  ) {
    // Tạm thời gán teacherId là ID của user đang đăng nhập (hoặc nếu là admin thì có thể chọn, nhưng để đơn giản ta gán luôn req.user.id)
    return this.courseService.createClass(courseId, req.user.id, dto);
  }

  @Get('classes/:classId')
  @ApiOperation({ summary: 'Lấy chi tiết lớp học (chứa Lessons và Materials)' })
  getClassById(@Param('classId', ParseIntPipe) classId: number) {
    return this.courseService.getClassById(classId);
  }

  // --- Lessons & Materials ---

  @Post(':courseId/lessons')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo bài học mới cho khóa học' })
  createLesson(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateLessonDto,
  ) {
    return this.courseService.createLesson(courseId, dto);
  }

  @Post('lessons/:lessonId/materials')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thêm tài liệu cho bài học' })
  createMaterial(
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() dto: CreateMaterialDto,
  ) {
    return this.courseService.createMaterial(lessonId, dto);
  }
}
