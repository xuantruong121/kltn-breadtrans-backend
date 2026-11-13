import { Controller, Get, Optional, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { aiQuotaKey } from '../../common/guards/ai-rate-limit.guard';
import { getBusinessDayKey } from '../../common/time/business-time.util';
import { tutorQuotaKey } from '../ai/tutor-prompt.logic';
import { buildDailyUsage, type DailyUsage } from './daily-usage';
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
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {}

  /**
   * Today's AI gradings and tutor questions, read without spending any
   * (owner 2026-11-13: "Gói của tôi" shows what is left).
   */
  @Get('me/usage')
  @ApiOperation({
    summary:
      'Lượt AI chấm (Nói và Viết) và lượt hỏi Trợ lý đã dùng hôm nay, theo gói, làm mới lúc 00:00 giờ Việt Nam',
  })
  @ApiResponse({
    status: 200,
    description: 'Số lượt đã dùng và còn lại hôm nay',
  })
  async getMyUsage(
    @Request() request: { user: { id: number } },
  ): Promise<DailyUsage> {
    const userId = request.user.id;
    const day = getBusinessDayKey();
    const [planCode, counters] = await Promise.all([
      this.subscriptionService.planCodeFor(userId),
      this.redis
        ? this.redis.mget(aiQuotaKey(userId, day), tutorQuotaKey(userId, day))
        : Promise.resolve([null, null]),
    ]);
    return buildDailyUsage(planCode, counters[0], counters[1], new Date());
  }

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
