import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
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

  // ==========================================
  // PET & DAILY QUESTS
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('pet')
  @ApiOperation({ summary: 'Lấy thông tin thú cưng của học sinh' })
  getMyPet(@Request() req: any) {
    return this.gamificationService.getMyPet(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('pet/feed')
  @ApiOperation({ summary: 'Cho thú cưng ăn (Tiêu hao bánh rán)' })
  feedPet(@Request() req: any) {
    return this.gamificationService.feedPet(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('pet/change-type')
  @ApiOperation({ summary: 'Đổi loài thú cưng' })
  changePetType(@Request() req: any, @Body('petName') petName: string) {
    return this.gamificationService.changePetType(
      req.user.id,
      petName || 'Bánh Mì Dũng Cảm',
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('quests')
  @ApiOperation({ summary: 'Lấy danh sách nhiệm vụ hôm nay và tiến độ' })
  getMyDailyQuests(@Request() req: any) {
    return this.gamificationService.getMyDailyQuests(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('vocab-learned')
  @ApiOperation({
    summary: 'Ghi nhận học từ vựng mới để tính tiến độ nhiệm vụ ngày',
  })
  recordVocabLearned(@Body('count') count: number, @Request() req: any) {
    return this.gamificationService.recordVocabLearned(req.user.id, count || 1);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('arena/snippet')
  @ApiOperation({ summary: 'Lấy tóm tắt rank đấu trường cho trang chủ' })
  getArenaSnippet(@Request() req: any) {
    return this.gamificationService.getArenaSnippet(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('spin-wheel')
  @ApiOperation({ summary: 'Quay vòng quay may mắn (tốn 50 Bánh Rán)' })
  spinWheel(@Request() req: any) {
    return this.gamificationService.spinWheel(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('admiration/send')
  @ApiOperation({
    summary: 'Gửi lời ngưỡng mộ tới bạn học & bắn Web Push Notification',
  })
  sendAdmiration(
    @Request() req: any,
    @Body() body: { targetUserId: number; message?: string },
  ) {
    return this.gamificationService.sendAdmiration(
      req.user.id,
      body.targetUserId,
      body.message,
    );
  }

  // NOTE: Thường cronjob chạy tự động, nhưng để test thì mở API POST
  @Post('trigger-daily-cron')
  @ApiOperation({ summary: '[Test] Chạy cronjob bảo vệ chuỗi mỗi ngày' })
  triggerDailyCron() {
    return this.gamificationService.triggerDailyCron();
  }

  @Post('trigger-weekly-cron')
  @ApiOperation({ summary: '[Test] Chạy cronjob cập nhật Giải đấu hàng tuần' })
  triggerWeeklyCron() {
    return this.gamificationService.triggerWeeklyCron();
  }
}
