import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Role } from '@prisma/client';
import { Response } from 'express';

@Injectable()
export class AiRateLimitGuard implements CanActivate {
  constructor(@InjectRedis() private readonly redis: Redis) {}

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

    // Miễn giới hạn cho ADMIN và TEACHER
    if (user.role === Role.ADMIN || user.role === Role.TEACHER) {
      return true;
    }

    const limit = parseInt(process.env.AI_DAILY_QUOTA_PER_USER || '30', 10);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `ai_quota:${user.id}:${today}`;

    // Atomic INCR trên Redis (O(1), TOCTOU-free)
    const count = await this.redis.incr(key);
    if (count === 1) {
      // Đặt TTL 24 giờ cho key quota của ngày hôm nay
      await this.redis.expire(key, 86400);
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
          message: `Bạn đã dùng hết hạn mức ${limit} lượt gọi AI hôm nay. Vui lòng quay lại vào ngày mai!`,
          limit,
          currentUsage: count,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
