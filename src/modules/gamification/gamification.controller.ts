import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('gamification')
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Get('leaderboard')
  @ApiOperation({ summary: 'Lấy top 10 bảng xếp hạng điểm số' })
  getLeaderboard() {
    return this.gamificationService.getLeaderboard();
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('badges/me')
  @ApiOperation({ summary: 'Lấy danh sách huy hiệu của học viên hiện tại' })
  getMyBadges(@Request() req: any) {
    return this.gamificationService.getMyBadges(req.user.id);
  }
}
