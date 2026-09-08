import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClassService } from './class.service';
import { UpdateWatchTrackingDto } from './dto/update-watch-tracking.dto';

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
    @Body() body: UpdateWatchTrackingDto,
  ) {
    const played =
      typeof body.played === 'number'
        ? body.played
        : typeof body.data?.played === 'number'
          ? body.data.played
          : NaN;
    return this.classService.updateWatchTracking(
      req.user.id,
      body.videoKey,
      played,
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
