import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { SubscribeDto, UnsubscribeDto } from './dto/push-subscription.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('public-key')
  getPublicKey() {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY || '',
    };
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async subscribe(@Req() req: any, @Body() dto: SubscribeDto) {
    const userId = req.user.id;
    return await this.notificationsService.subscribe(userId, dto);
  }

  @Post('unsubscribe')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@Req() req: any, @Body() dto: UnsubscribeDto) {
    const userId = req.user.id;
    return await this.notificationsService.unsubscribe(dto.endpoint, userId);
  }

  @Post('test')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sendTestPush(@Req() req: any) {
    const userId = req.user.id;
    const result = await this.notificationsService.sendPushToUser(userId, {
      title: 'BreadTrans - Kiểm Tra Thông Báo! 🍞',
      body: 'Chúc mừng bạn đã kích hoạt thành công tính năng Web Push Notification trên thiết bị!',
      icon: '/icons/icon-192.png',
      url: '/practice',
    });
    return {
      success: true,
      message: 'Đã phát tín hiệu gửi thông báo thử nghiệm.',
      result,
    };
  }

  @Get('inbox')
  @UseGuards(JwtAuthGuard)
  async getInbox(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: number,
  ) {
    return await this.notificationsService.getInbox(req.user.id, limit, cursor);
  }

  @Get('inbox/unread-count')
  @UseGuards(JwtAuthGuard)
  async getUnreadCount(@Req() req: any) {
    return await this.notificationsService.getUnreadCount(req.user.id);
  }

  @Patch('inbox/read-all')
  @UseGuards(JwtAuthGuard)
  async markAllRead(@Req() req: any) {
    return await this.notificationsService.markAllRead(req.user.id);
  }

  @Patch('inbox/:id/read')
  @UseGuards(JwtAuthGuard)
  async markRead(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return await this.notificationsService.markRead(req.user.id, id);
  }
}
