import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateLearnerProfileDto } from './dto/learner-profile.dto';
import { LearningPathService } from './learning-path.service';

@ApiTags('learning-path')
@Controller('learning-path')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LearningPathController {
  constructor(private readonly learningPath: LearningPathService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'Hồ sơ học tập: mục tiêu, hướng nghề, thời gian, mức luyện tập',
  })
  @ApiResponse({ status: 200, description: 'Hồ sơ và mức từng kỹ năng.' })
  getProfile(@Request() req: { user: { id: number } }) {
    return this.learningPath.getProfile(req.user.id);
  }

  @Put('profile')
  @ApiOperation({
    summary: 'Cập nhật hồ sơ học tập (onboarding, tự chọn mức)',
  })
  @ApiResponse({ status: 200, description: 'Hồ sơ sau cập nhật.' })
  @ApiResponse({
    status: 409,
    description: 'Đã có mức từ bài kiểm tra đầu vào; không tự chọn mức.',
  })
  updateProfile(
    @Request() req: { user: { id: number } },
    @Body() dto: UpdateLearnerProfileDto,
  ) {
    return this.learningPath.updateProfile(req.user.id, dto);
  }
}
