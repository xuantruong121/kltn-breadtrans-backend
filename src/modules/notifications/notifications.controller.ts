import {
  Controller,
  Post,
  Get,
  Body,
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
      publicKey:
        process.env.VAPID_PUBLIC_KEY ||
        'BBHW4US29BdbTAUO0IWZIvZPRd9eFQZ7pibsO7mEvTziEI-R_bfnWqEelWkCQrn_CrldpBlpsmCbtOFSMSmxPhY',
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
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@Body() dto: UnsubscribeDto) {
    return await this.notificationsService.unsubscribe(dto.endpoint);
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
      url: '/student/profile',
    });
    return {
      success: true,
      message: 'Đã phát tín hiệu gửi thông báo thử nghiệm.',
      result,
    };
  }
}
