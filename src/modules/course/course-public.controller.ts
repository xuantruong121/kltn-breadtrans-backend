import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CourseService } from './course.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@ApiTags('public-courses')
@Controller('public/courses')
export class CoursePublicController {
  constructor(private readonly courseService: CourseService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Lấy danh mục các khóa học đã xuất bản (Public Course Catalog)',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách các khóa học công khai dành cho khách vãng lai',
  })
  getPublicCatalog(@Request() req?: any) {
    return req
      ? this.courseService.getPublicCatalog(req.user?.id, req.user?.role)
      : this.courseService.getPublicCatalog();
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Xem chi tiết khóa học công khai (Public Course Detail)',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết khóa học tự học và lộ trình hoạt động',
  })
  @ApiResponse({
    status: 404,
    description: 'Khóa học không tồn tại hoặc chưa xuất bản',
  })
  getPublicCourseDetail(
    @Param('id', ParseIntPipe) id: number,
    @Request() req?: any,
  ) {
    return req
      ? this.courseService.getPublicCourseDetail(
          id,
          req.user?.id,
          req.user?.role,
        )
      : this.courseService.getPublicCourseDetail(id);
  }
}
