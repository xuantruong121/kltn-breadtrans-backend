import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { LearningContentType, PracticeSkill } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateLearnerProfileDto } from './dto/learner-profile.dto';
import { LearningItemDto } from './dto/learning-item.dto';
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

  @Get('today')
  @ApiOperation({
    summary: 'Nhiệm vụ hôm nay: bài luyện đề xuất vừa thời gian mỗi ngày',
  })
  @ApiResponse({ status: 200, description: 'Bài đang mở, kèm lý do đề xuất.' })
  today(@Request() req: { user: { id: number } }) {
    return this.learningPath.today(req.user.id);
  }

  @Get('skills/:skill/recommended')
  @ApiOperation({
    summary: 'Đề xuất cho bạn theo kỹ năng (gồm bài còn khóa và lý do)',
  })
  @ApiResponse({ status: 200, description: 'Danh sách đề xuất đã xếp hạng.' })
  recommended(
    @Request() req: { user: { id: number } },
    @Param('skill', new ParseEnumPipe(PracticeSkill)) skill: PracticeSkill,
  ) {
    return this.learningPath.recommendedForSkill(req.user.id, skill);
  }

  @Get('saved')
  @ApiOperation({ summary: 'Bài luyện học viên đã lưu' })
  @ApiResponse({ status: 200, description: 'Danh sách bài đã lưu.' })
  saved(@Request() req: { user: { id: number } }) {
    return this.learningPath.saved(req.user.id);
  }

  @Post('items/save')
  @ApiOperation({ summary: 'Lưu một bài luyện vào lộ trình' })
  @ApiResponse({ status: 201, description: 'Đã lưu.' })
  @ApiResponse({ status: 404, description: 'Không có bài luyện này.' })
  save(@Request() req: { user: { id: number } }, @Body() dto: LearningItemDto) {
    return this.learningPath.saveItem(
      req.user.id,
      dto.contentType,
      dto.contentId,
    );
  }

  @Delete('items/:contentType/:contentId')
  @ApiOperation({ summary: 'Bỏ lưu một bài luyện' })
  @ApiResponse({ status: 200, description: 'Đã bỏ lưu.' })
  unsave(
    @Request() req: { user: { id: number } },
    @Param('contentType', new ParseEnumPipe(LearningContentType))
    contentType: LearningContentType,
    @Param('contentId', ParseIntPipe) contentId: number,
  ) {
    return this.learningPath.unsaveItem(req.user.id, contentType, contentId);
  }
}
