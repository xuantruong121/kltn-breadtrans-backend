import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { getJwtVerificationKey } from '../auth.constants';
import {
  AUTH_USER_TTL_MS,
  cachedAuthUser,
  rememberAuthUser,
} from '../auth-user-cache';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // passport-jwt hands this to jsonwebtoken.verify, which takes a KeyObject;
      // its typings only list string | Buffer.
      secretOrKey: getJwtVerificationKey() as unknown as Buffer,
      passReqToCallback: true,
    });
  }

  /** See auth-user-cache.ts: the account is read at most every 60 s. */
  static readonly USER_TTL_MS = AUTH_USER_TTL_MS;

  private async currentUser(id: number) {
    const cached = cachedAuthUser(id);
    if (cached !== undefined) return cached;
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        mustChangePassword: true,
      },
    });
    rememberAuthUser(id, user);
    return user;
  }

  async validate(req: any, payload: any) {
    if (!payload || payload.type !== 'access' || !payload.deviceId) {
      throw new UnauthorizedException('Yêu cầu access token hợp lệ.');
    }

    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!rawToken) {
      throw new UnauthorizedException('Vui lòng đăng nhập để tiếp tục.');
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    if (await this.redis.get(`jwt:denylist:${tokenHash}`)) {
      throw new UnauthorizedException('Token đã bị thu hồi.');
    }

    const loggedOutAt = await this.redis.get(
      `user:${payload.sub}:device:${payload.deviceId}:logged_out_at`,
    );
    if (
      loggedOutAt &&
      payload.iat &&
      payload.iat * 1000 < Number(loggedOutAt)
    ) {
      throw new UnauthorizedException('Phiên thiết bị đã kết thúc.');
    }

    const user = await this.currentUser(payload.sub);

    if (!user) {
      throw new UnauthorizedException(
        'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
      );
    }

    if (user.role !== 'ADMIN' && user.role !== 'STUDENT') {
      throw new UnauthorizedException('Tài khoản không còn được hỗ trợ.');
    }

    const path = req?.route?.path || req?.path || '';
    if (
      user.mustChangePassword &&
      !String(path).endsWith('/change-password') &&
      !String(path).endsWith('/logout')
    ) {
      throw new ForbiddenException('Bạn phải đổi mật khẩu trước khi tiếp tục.');
    }

    return {
      ...user,
      deviceId: payload.deviceId,
      jti: payload.jti,
      tokenType: payload.type,
    };
  }
}
