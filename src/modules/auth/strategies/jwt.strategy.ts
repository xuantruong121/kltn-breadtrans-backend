import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { getJwtSecret } from '../auth.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: any) {
    if (!payload || payload.type !== 'access' || !payload.deviceId) {
      throw new UnauthorizedException('Yêu cầu access token hợp lệ.');
    }

    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!rawToken) {
      throw new UnauthorizedException('Access token is required.');
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    if (await this.redis.get(`jwt:denylist:${tokenHash}`)) {
      throw new UnauthorizedException('Token đã bị thu hồi.');
    }

    const loggedOutAt = await this.redis.get(
      `user:${payload.sub}:device:${payload.deviceId}:logged_out_at`,
    );
    if (loggedOutAt && payload.iat && payload.iat * 1000 < Number(loggedOutAt)) {
      throw new UnauthorizedException('Phiên thiết bị đã kết thúc.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Token is invalid or user does not exist',
      );
    }

    return {
      ...user,
      deviceId: payload.deviceId,
      jti: payload.jti,
      tokenType: payload.type,
    };
  }
}
