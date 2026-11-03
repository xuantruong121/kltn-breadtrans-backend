import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { SkipResponseTransform } from './common/decorators/skip-response-transform.decorator';
import { PrismaService } from './prisma/prisma.service';

/** Container healthcheck; see docker-compose.production.yml. */
@ApiTags('Health')
@Controller('api/health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Get()
  @SkipResponseTransform()
  @ApiOperation({ summary: 'Kiểm tra API, PostgreSQL và Redis còn hoạt động' })
  @ApiResponse({ status: 200, description: 'Sẵn sàng phục vụ' })
  @ApiResponse({
    status: 503,
    description: 'PostgreSQL hoặc Redis không phản hồi',
  })
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
    } catch {
      // The reason stays in the server log; the caller needs only the status.
      throw new ServiceUnavailableException('Dịch vụ chưa sẵn sàng');
    }
    return { status: 'ok' };
  }
}
