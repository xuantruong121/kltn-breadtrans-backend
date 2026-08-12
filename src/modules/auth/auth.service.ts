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

    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload, { expiresIn: '1h' });

    // Generate a secure random refresh token family ID
    const refreshToken = crypto.randomBytes(40).toString('hex');

    // Store in Redis: user:{userId}:device:{deviceId} -> refreshToken (7 days TTL)
    const redisKey = `user:${user.id}:device:${deviceId}`;
    await this.redis.set(redisKey, refreshToken, 'EX', 7 * 24 * 60 * 60);

    return {
      access_token,
      refresh_token: refreshToken,
      deviceId, // Tell client what device ID we registered (if they didn't provide one, maybe we generate one? Actually we require it in DTO)
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
    const redisKey = `user:${userId}:device:${deviceId}`;
    const storedToken = await this.redis.get(redisKey);

    // REUSE DETECTION (Replay Attack)
    // If the provided refresh token does not match the one in Redis, someone is trying to reuse an old or invalid token!
    if (storedToken !== providedRefreshToken) {
      // Security measure: Revoke ALL tokens for this device (or user) to force re-authentication
      await this.redis.del(redisKey);
      throw new UnauthorizedException(
        'Replay attack detected or token expired. Session revoked.',
      );
    }

    // Token is valid. Rotate it!
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload, { expiresIn: '1h' });
    const new_refresh_token = crypto.randomBytes(40).toString('hex');

    // Replace old token with new one in Redis
    await this.redis.set(redisKey, new_refresh_token, 'EX', 7 * 24 * 60 * 60);

    return {
      access_token,
      refresh_token: new_refresh_token,
    };
  }

  async logout(userId: number, deviceId: string) {
    const redisKey = `user:${userId}:device:${deviceId}`;
    await this.redis.del(redisKey);
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
