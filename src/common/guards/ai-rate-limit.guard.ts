import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Role } from '@prisma/client';
import { Response } from 'express';

import { getBusinessDayKey } from '../time/business-time.util';
import {
  aiGradingLimitMessage,
  planLimits,
  type PlanCode,
} from '../../modules/subscription/plan-limits';
import { SubscriptionService } from '../../modules/subscription/subscription.service';

/** Redis key of one learner's AI gradings for one Vietnam day. */
export const aiQuotaKey = (userId: number, dayKey: string) =>
  `ai_quota:${userId}:${dayKey}`;

/**
 * AI gradings per learner per day (Speaking and Writing answers, revisions,
 * AI explanations). The number is the learner's plan's (plan-limits.ts: Free
 * 10, Plus 30, Pro 60). The day is the Vietnam day, like the tutor's limit.
 * Without a readable plan the learner gets the Free number: a limit must not
 * open because a lookup failed.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Optional() private readonly subscriptions?: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const user = req.user;

    // Fail-closed: Nếu chưa xác thực JWT thì chặn, không được bỏ qua
    if (!user || !user.id) {
      throw new UnauthorizedException(
        'Vui lòng đăng nhập trước khi sử dụng tính năng AI',
      );
    }

    // Miễn giới hạn cho ADMIN
    if (user.role === Role.ADMIN) {
      return true;
    }

    const planCode: PlanCode =
      (await this.subscriptions?.planCodeFor(user.id)) ?? 'FREE';
    const limit = planLimits(planCode).aiGradingPerDay;
    const key = aiQuotaKey(user.id, getBusinessDayKey());

    // Atomic INCR trên Redis (O(1), TOCTOU-free)
    const count = await this.redis.incr(key);
    if (count === 1) {
      // The key outlives its day by a margin and then goes away.
      await this.redis.expire(key, 2 * 86400);
    }

    const res = http.getResponse<Response>();
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('X-AI-Quota-Limit', limit);
      res.setHeader('X-AI-Quota-Remaining', Math.max(0, limit - count));
    }

    if (count > limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: aiGradingLimitMessage(planCode),
          limit,
          currentUsage: count,
          planCode,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
