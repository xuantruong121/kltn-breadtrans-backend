import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CourseService } from './course.service';

@ApiTags('public-courses')
@Controller('public/courses')
export class CoursePublicController {
  constructor(private readonly courseService: CourseService) {}

  @Get()
  @ApiOperation({
    summary: 'Lấy danh mục các khóa học đã xuất bản (Public Course Catalog)',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách các khóa học công khai dành cho khách vãng lai',
  })
  getPublicCatalog() {
    return this.courseService.getPublicCatalog();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Xem chi tiết khóa học công khai (Public Course Detail)',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết khóa học và danh sách các lớp sắp mở (UPCOMING)',
  })
  @ApiResponse({
    status: 404,
    description: 'Khóa học không tồn tại hoặc chưa xuất bản',
  })
  getPublicCourseDetail(@Param('id', ParseIntPipe) id: number) {
    return this.courseService.getPublicCourseDetail(id);
  }
}
