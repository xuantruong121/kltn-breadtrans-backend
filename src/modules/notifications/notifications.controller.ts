import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
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
      title: 'BreadTrans - Kiểm tra thông báo',
      body: 'Chúc mừng bạn đã kích hoạt thành công tính năng Web Push Notification trên thiết bị!',
      icon: '/icons/icon-192.png',
      url: '/dashboard',
    });
    return {
      success: true,
      message: 'Đã phát tín hiệu gửi thông báo thử nghiệm.',
      result,
    };
  }

  @Get('inbox')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Thông báo của học viên, mới nhất trước: theo trang (page) hoặc theo cursor',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '1–50, mặc định 20',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description:
      'Trang (từ 1). Có page thì trả thêm total, totalPages; trang quá cuối trả trang cuối',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Id thông báo cuối của lần trước (khi không dùng page)',
  })
  @ApiQuery({
    name: 'filter',
    required: false,
    enum: ['all', 'unread', 'read'],
  })
  @ApiResponse({
    status: 200,
    description:
      'items, nextCursor; với page thêm page, pageSize, total, totalPages',
  })
  async getInbox(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: number,
    @Query('filter') filter?: 'all' | 'unread' | 'read',
    @Query('page') page?: number,
  ) {
    return await this.notificationsService.getInbox(
      req.user.id,
      limit,
      cursor,
      filter,
      page,
    );
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
    const result = await this.notificationsService.markRead(req.user.id, id);
    if (!result.success) throw new NotFoundException(result.message);
    return result;
  }

  @Delete('inbox/:id')
  @UseGuards(JwtAuthGuard)
  async deleteNotification(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.notificationsService.deleteNotification(
      req.user.id,
      id,
    );
    if (!result.success) throw new NotFoundException(result.message);
    return result;
  }
}
