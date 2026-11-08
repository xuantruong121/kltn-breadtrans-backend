import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RankingService } from './ranking.service';

/** Bảng xếp hạng: public, with the learner's own place when signed in. */
@ApiTags('gamification')
@UseGuards(OptionalJwtAuthGuard)
@Controller('gamification/ranking')
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Get()
  @ApiOperation({
    summary:
      'Bảng xếp hạng theo XP (hôm nay, tuần, tháng, tất cả), chuỗi ngày học hoặc số bạn giới thiệu',
  })
  @ApiQuery({
    name: 'metric',
    required: false,
    enum: ['xp', 'streak', 'referral'],
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['today', 'week', 'month', 'all'],
  })
  @ApiResponse({
    status: 200,
    description: 'Top 50, tổng số, vị trí của học viên đang đăng nhập',
  })
  @ApiResponse({ status: 400, description: 'Tiêu chí hoặc kỳ không hợp lệ' })
  getRanking(
    @Request() req: any,
    @Query('metric') metric?: string,
    @Query('period') period?: string,
  ) {
    const userId = req.user?.id ? Number(req.user.id) : undefined;
    return this.ranking.getRanking(metric, period, userId);
  }

  @Get('hall-of-fame')
  @ApiOperation({
    summary:
      'Đại sảnh danh vọng: XP cao nhất, chuỗi dài nhất, giới thiệu nhiều nhất',
  })
  @ApiResponse({
    status: 200,
    description: 'Ba học viên dẫn đầu, mỗi mục có thể trống',
  })
  getHallOfFame() {
    return this.ranking.getHallOfFame();
  }

  @Get('activity')
  @ApiOperation({
    summary: 'Hoạt động học tập gần đây của học viên (tên đã che bớt)',
  })
  @ApiResponse({ status: 200, description: '15 sự kiện mới nhất' })
  getActivity() {
    return this.ranking.getActivity();
  }
}
