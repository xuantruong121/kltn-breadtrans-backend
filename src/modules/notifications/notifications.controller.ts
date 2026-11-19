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
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Lưu đăng ký thông báo trình duyệt (Web Push) của trình duyệt này cho học viên đang đăng nhập',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã lưu; cùng endpoint thì cập nhật và gán cho học viên này',
  })
  async subscribe(@Req() req: any, @Body() dto: SubscribeDto) {
    const userId = req.user.id;
    return await this.notificationsService.subscribe(userId, dto);
  }

  @Post('unsubscribe')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Huỷ đăng ký thông báo trình duyệt của một endpoint',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã xoá đăng ký của học viên này (nếu có)',
  })
  async unsubscribe(@Req() req: any, @Body() dto: UnsubscribeDto) {
    const userId = req.user.id;
    return await this.notificationsService.unsubscribe(dto.endpoint, userId);
  }

  @Post('test')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Gửi một thông báo trình duyệt thử tới mọi trình duyệt đã đăng ký của học viên',
  })
  @ApiResponse({
    status: 200,
    description: 'result.sent: số trình duyệt nhận được; result.failed',
  })
  async sendTestPush(@Req() req: any) {
    const userId = req.user.id;
    const result = await this.notificationsService.sendPushToUser(userId, {
      title: 'BreadTrans - Thông báo thử',
      body: 'Thông báo trình duyệt đã bật trên thiết bị này.',
      icon: '/icons/icon-192.png',
      url: '/hub?tab=account-device',
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
