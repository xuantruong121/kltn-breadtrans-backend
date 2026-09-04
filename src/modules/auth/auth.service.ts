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

    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload, { expiresIn: '1d' });

    // Generate signed JWT refresh token (30 days) containing userId and deviceId
    const refreshToken = this.jwtService.sign(
      { sub: user.id, deviceId, type: 'refresh' },
      { expiresIn: '30d' },
    );

    // Store in Redis (30 days TTL) and save to PostgreSQL as durable fallback
    const redisKey = `user:${user.id}:device:${deviceId}`;
    try {
      await this.redis.set(redisKey, refreshToken, 'EX', 30 * 24 * 60 * 60);
    } catch (redisErr) {
      console.warn(
        '[AuthService] Failed to set refresh token in Redis:',
        redisErr,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

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

    const effectiveUserId = tokenPayload?.sub || userId;
    const effectiveDeviceId = tokenPayload?.deviceId || deviceId;

    if (!effectiveUserId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const redisKey = `user:${effectiveUserId}:device:${effectiveDeviceId}`;
    let storedToken: string | null = null;
    try {
      storedToken = await this.redis.get(redisKey);
    } catch (err) {
      console.warn('[AuthService] Redis get failed during refresh:', err);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: effectiveUserId },
      include: { profile: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    // 2. Check token validity: Redis first, DB fallback if Redis was restarted/flushed
    const isValidToken =
      storedToken === providedRefreshToken ||
      user.refreshToken === providedRefreshToken;

    if (!isValidToken) {
      if (storedToken) {
        await this.redis.del(redisKey);
      }
      throw new UnauthorizedException(
        'Replay attack detected or token expired. Session revoked.',
      );
    }

    // 3. Token is valid. Rotate tokens!
    const payload = { sub: user.id, email: user.email, role: user.role };
    const new_access_token = this.jwtService.sign(payload, { expiresIn: '1d' });
    const new_refresh_token = this.jwtService.sign(
      { sub: user.id, deviceId: effectiveDeviceId, type: 'refresh' },
      { expiresIn: '30d' },
    );

    // Replace old token with new one in Redis and PostgreSQL
    try {
      await this.redis.set(
        redisKey,
        new_refresh_token,
        'EX',
        30 * 24 * 60 * 60,
      );
    } catch (redisErr) {
      console.warn(
        '[AuthService] Failed to set rotated token in Redis:',
        redisErr,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: new_refresh_token },
    });

    return {
      access_token: new_access_token,
      refresh_token: new_refresh_token,
    };
  }

  async logout(userId: number, deviceId: string) {
    const redisKey = `user:${userId}:device:${deviceId}`;
    try {
      await this.redis.del(redisKey);
    } catch (err) {
      console.warn('[AuthService] Redis del failed during logout:', err);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    return { message: 'Logged out successfully' };
  }

  // ================= HMAC-SHA256 OTP =================

  async generateOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('User not found');

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits

    // Hash it before storing in Redis so even if Redis is breached, OTP is safe
    const secret = process.env.OTP_SECRET || 'secret-key-otp';
    const hash = crypto.createHmac('sha256', secret).update(otp).digest('hex');

    const redisKey = `otp:${email}`;
    await this.redis.set(redisKey, hash, 'EX', 300); // 5 mins TTL

    // In a real app, send email here!
    console.log(`[DEV MODE] OTP for ${email}: ${otp}`);

    return { message: 'OTP sent successfully (check console)' };
  }

  async verifyOtp(email: string, providedOtp: string) {
    const redisKey = `otp:${email}`;
    const storedHash = await this.redis.get(redisKey);
    if (!storedHash) throw new UnauthorizedException('OTP expired or invalid');

    const secret = process.env.OTP_SECRET || 'secret-key-otp';
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
