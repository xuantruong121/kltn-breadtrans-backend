import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import * as bcrypt from 'bcrypt';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { getOtpSecret } from './auth.constants';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, fullName } = registerDto;
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) throw new ConflictException('Email already exists');

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        profile: { create: { fullName } },
      },
      include: { profile: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
  }

  async login(loginDto: LoginDto, deviceId: string) {
    const { email, password } = loginDto;
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      throw new UnauthorizedException('Invalid credentials');

    // Update login count and last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    });

    const access_token = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        deviceId,
        type: 'access',
        jti: crypto.randomUUID(),
      },
      { expiresIn: '1d' },
    );

    // Generate signed JWT refresh token (30 days) containing userId and deviceId
    const refreshToken = this.jwtService.sign(
      { sub: user.id, deviceId, type: 'refresh' },
      { expiresIn: '30d' },
    );

    // Redis is the per-device source of truth for refresh sessions.
    const redisKey = `user:${user.id}:device:${deviceId}`;
    await this.redis.set(redisKey, refreshToken, 'EX', 30 * 24 * 60 * 60);

    return {
      access_token,
      refresh_token: refreshToken,
      deviceId,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile,
      },
    };
  }

  async refreshTokens(
    userId: number,
    deviceId: string,
    providedRefreshToken: string,
  ) {
    // 1. Verify token signature and type
    let tokenPayload: any = null;
    try {
      tokenPayload = this.jwtService.verify(providedRefreshToken);
    } catch {
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }

    if (tokenPayload?.type !== 'refresh') {
      throw new UnauthorizedException('Token type must be refresh');
    }

    const effectiveUserId = tokenPayload?.sub || userId;
    const effectiveDeviceId = tokenPayload?.deviceId;

    if (!effectiveUserId || !effectiveDeviceId) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (deviceId && deviceId !== effectiveDeviceId) {
      throw new UnauthorizedException('Refresh token device mismatch');
    }

    const redisKey = `user:${effectiveUserId}:device:${effectiveDeviceId}`;
    let storedToken: string | null = null;
    storedToken = await this.redis.get(redisKey);

    const user = await this.prisma.user.findUnique({
      where: { id: effectiveUserId },
      include: { profile: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    // 2. Check token validity only against the per-device Redis session.
    const isValidToken = storedToken === providedRefreshToken;

    if (!isValidToken) {
      if (storedToken) {
        await this.redis.del(redisKey);
      }
      throw new UnauthorizedException(
        'Replay attack detected or token expired. Session revoked.',
      );
    }

    // 3. Token is valid. Rotate tokens!
    const new_access_token = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        deviceId: effectiveDeviceId,
        type: 'access',
        jti: crypto.randomUUID(),
      },
      { expiresIn: '1d' },
    );
    const new_refresh_token = this.jwtService.sign(
      { sub: user.id, deviceId: effectiveDeviceId, type: 'refresh' },
      { expiresIn: '30d' },
    );

    // Replace the per-device refresh session in Redis only.
    await this.redis.set(redisKey, new_refresh_token, 'EX', 30 * 24 * 60 * 60);

    return {
      access_token: new_access_token,
      refresh_token: new_refresh_token,
    };
  }

  async logout(userId: number, deviceId: string, accessToken: string) {
    const redisKey = `user:${userId}:device:${deviceId}`;
    await this.redis.del(redisKey);
    await this.redis.set(
      `${redisKey}:logged_out_at`,
      Date.now().toString(),
      'EX',
      86400,
    );
    const tokenHash = crypto
      .createHash('sha256')
      .update(accessToken)
      .digest('hex');
    const decoded = this.jwtService.decode(accessToken);
    const remainingTtl = Math.max(
      1,
      (decoded?.exp ?? Math.floor(Date.now() / 1000) + 86400) -
        Math.floor(Date.now() / 1000),
    );
    await this.redis.set(
      `jwt:denylist:${tokenHash}`,
      'revoked',
      'EX',
      remainingTtl,
    );
    return { message: 'Logged out successfully' };
  }

  // ================= HMAC-SHA256 OTP =================

  async generateOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('User not found');

    // Cryptographically secure 6-digit OTP (100000 to 999999 inclusive)
    const otp = crypto.randomInt(100000, 1000000).toString();

    // Hash it before storing in Redis so even if Redis is breached, OTP is safe
    const secret = getOtpSecret();
    const hash = crypto.createHmac('sha256', secret).update(otp).digest('hex');

    const redisKey = `otp:${email}`;
    await this.redis.set(redisKey, hash, 'EX', 300); // 5 mins TTL

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV MODE ONLY] OTP for ${email}: ${otp}`);
    }

    return {
      message:
        process.env.NODE_ENV === 'production'
          ? 'OTP sent successfully'
          : 'OTP sent successfully (check console in DEV)',
    };
  }

  async verifyOtp(email: string, providedOtp: string) {
    const redisKey = `otp:${email}`;
    const storedHash = await this.redis.get(redisKey);
    if (!storedHash) throw new UnauthorizedException('OTP expired or invalid');

    const secret = getOtpSecret();
    const computedHash = crypto
      .createHmac('sha256', secret)
      .update(providedOtp)
      .digest('hex');

    if (storedHash !== computedHash) {
      throw new UnauthorizedException('Invalid OTP');
    }

    // Single-use: Destroy OTP
    await this.redis.del(redisKey);
    return { message: 'OTP verified successfully' };
  }
}
