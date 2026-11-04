import { Controller, Get, Optional, Request, UseGuards } from '@nestjs/common';
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
import { TrialService } from './trial.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    @Optional() private readonly trial?: TrialService,
  ) {}

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
      'Ngày còn lại của gói trả phí, gói gia hạn đã xếp (nếu có), nội dung trả phí đã dùng trong kỳ và lượt chấm còn lại khi đang dùng thử',
  })
  @ApiResponse({ status: 200, description: 'Tóm tắt trước khi gói hết hạn' })
  async getMyExpirySummary(
    @Request() request: { user: { id: number } },
  ): Promise<
    ExpirySummary & {
      trial: {
        endsAt: string;
        speakingLeft: number;
        writingLeft: number;
      } | null;
    }
  > {
    const [summary, trial] = await Promise.all([
      this.subscriptionService.getExpirySummary(request.user.id),
      this.trial?.status(request.user.id) ?? null,
    ]);
    // A running free trial: what is left of its gradings.
    return { ...summary, trial: trial ?? null };
  }
}
