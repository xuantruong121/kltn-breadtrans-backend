import { Controller, Get, Post, Body, Param, Delete, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { CourseService } from './course.service';
import { CreateCourseDto, CreateClassDto, CreateLessonDto, CreateMaterialDto } from './dto/course.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('courses')
@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
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

  // --- Classes ---
  
  @Post(':courseId/classes')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo lớp học mới cho khóa học (TEACHER tự gán mình vào lớp)' })
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

  @Post('classes/:classId/lessons')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo bài học mới cho lớp học' })
  createLesson(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: CreateLessonDto,
  ) {
    return this.courseService.createLesson(classId, dto);
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
