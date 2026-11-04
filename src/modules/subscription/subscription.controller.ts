import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  EffectivePlan,
  ExpirySummary,
  SubscriptionService,
} from './subscription.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lấy gói và quyền hiệu lực của tài khoản hiện tại' })
  getMyEffectivePlan(
    @Request() request: { user: { id: number } },
  ): Promise<EffectivePlan> {
    return this.subscriptionService.resolveEffectivePlan(request.user.id);
  }

  @Get('me/expiry-summary')
  @ApiOperation({
    summary:
      'Ngày còn lại của gói trả phí, gói gia hạn đã xếp (nếu có) và nội dung trả phí đã dùng trong kỳ',
  })
  @ApiResponse({ status: 200, description: 'Tóm tắt trước khi gói hết hạn' })
  getMyExpirySummary(
    @Request() request: { user: { id: number } },
  ): Promise<ExpirySummary> {
    return this.subscriptionService.getExpirySummary(request.user.id);
  }
}
