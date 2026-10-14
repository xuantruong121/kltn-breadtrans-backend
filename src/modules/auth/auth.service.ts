import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  LoginDto,
  RegisterDto,
  GoogleLoginDto,
  LinkGoogleAccountDto,
} from './dto/auth.dto';
import * as bcrypt from 'bcrypt';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { getOtpSecret } from './auth.constants';
import { Role } from '@prisma/client';
import { GoogleProfile } from './strategies/google.strategy';
import { OAuth2Client } from 'google-auth-library';
import { EmailService } from '../../common/email/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @InjectRedis() private readonly redis: Redis,
    private readonly emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, fullName } = registerDto;
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) throw new ConflictException('Email already exists');
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        profile: { create: { fullName } },
      },
      include: { profile: true },
    });
    const { password: createdPassword, ...safeUser } = user;
    void createdPassword;
    return safeUser;
  }

  async requestPasswordReset(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const genericResponse = {
      message:
        'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư của bạn.',
    };
    const cooldownKey = `auth:password-reset:cooldown:${email}`;
    const accepted = await this.redis.set(cooldownKey, '1', 'EX', 60, 'NX');
    if (accepted !== 'OK') return genericResponse;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return genericResponse;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const tokenKey = `auth:password-reset:token:${tokenHash}`;
    const userTokenKey = `auth:password-reset:user:${user.id}`;
    const previousTokenHash = await this.redis.get(userTokenKey);
    if (previousTokenHash) {
      await this.redis.del(`auth:password-reset:token:${previousTokenHash}`);
    }

    const ttlSeconds = 15 * 60;
    await this.redis.set(tokenKey, String(user.id), 'EX', ttlSeconds);
    await this.redis.set(userTokenKey, tokenHash, 'EX', ttlSeconds);

    const frontendUrl = (
      process.env.FRONTEND_URL || 'http://localhost:3000'
    ).replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
    try {
      await this.emailService.sendPasswordResetEmail(email, resetUrl);
    } catch (error) {
      this.logger.error(`Password reset email failed for ${email}`, error);
    }

    return genericResponse;
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const tokenKey = `auth:password-reset:token:${tokenHash}`;
    const rawUserId = await this.redis.getdel(tokenKey);
    if (!rawUserId) {
      throw new UnauthorizedException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    }

    const userId = Number(rawUserId);
    const userTokenKey = `auth:password-reset:user:${userId}`;
    const currentTokenHash = await this.redis.get(userTokenKey);
    if (currentTokenHash !== tokenHash) {
      throw new UnauthorizedException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    }

    const password = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password, mustChangePassword: false },
    });
    await this.redis.del(userTokenKey);

    const sessionKeys = await this.redis.keys(`user:${userId}:device:*`);
    if (sessionKeys.length > 0) await this.redis.del(...sessionKeys);

    return { message: 'Đặt lại mật khẩu thành công.' };
  }
  async login(loginDto: LoginDto, deviceId: string) {
    const { email, password } = loginDto;
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    if (!user || !user.password)
      throw new UnauthorizedException('Invalid credentials');

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

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(currentPassword, user.password))
    )
      throw new UnauthorizedException('Current password is invalid');

    const password = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password, mustChangePassword: false },
    });
    return { message: 'Password changed successfully' };
  }

  /**
   * Google Identity Services (GIS) Sign-In verification & issue tokens.
   * New users are strictly Role.STUDENT.
   * If email matches existing password account, throw ACCOUNT_LINK_REQUIRED.
   */
  async loginWithGoogle(dto: GoogleLoginDto) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Google Client ID chưa được cấu hình trên hệ thống.',
      );
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.credential,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(
        'Token Google không hợp lệ hoặc đã hết hạn.',
      );
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Tài khoản Google không hợp lệ hoặc email chưa được xác minh.',
      );
    }

    const googleSub = payload.sub;
    const email = payload.email.toLowerCase();
    const fullName = payload.name || 'Học viên BreadTrans';
    const avatar = payload.picture || null;
    const deviceId = dto.deviceId || crypto.randomUUID();

    const user = await this.resolveGoogleUser({
      providerId: googleSub,
      email,
      fullName,
      avatar,
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
    });
    return this.issueTokens(user, deviceId);
  }

  /**
   * Liên kết tài khoản Google với tài khoản đã tồn tại qua xác nhận mật khẩu.
   */
  async linkGoogleWithPassword(dto: LinkGoogleAccountDto) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Google Client ID chưa được cấu hình.',
      );
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.credential,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Token Google không hợp lệ.');
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Tài khoản Google không hợp lệ hoặc email chưa được xác minh.',
      );
    }

    const email = dto.email.toLowerCase();
    if (payload.email.toLowerCase() !== email) {
      throw new UnauthorizedException(
        'Email tài khoản Google không khớp với email đăng nhập.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException(
        'Tài khoản hoặc mật khẩu không chính xác.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Mật khẩu không chính xác.');
    }

    const deviceId = dto.deviceId || crypto.randomUUID();

    const linkedAccount = await this.prisma.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: payload.sub,
        },
      },
      select: { userId: true },
    });
    if (linkedAccount && linkedAccount.userId !== user.id) {
      throw new ConflictException(
        'Tài khoản Google này đã được liên kết với một tài khoản khác.',
      );
    }

    await this.prisma.authAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: payload.sub,
        },
      },
      update: {
        userId: user.id,
      },
      create: {
        provider: 'GOOGLE',
        providerAccountId: payload.sub,
        userId: user.id,
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
    });

    return this.issueTokens(user, deviceId);
  }

  /**
   * Google is an identity provider, not a role provider. New accounts are
   * always STUDENT and existing email accounts are linked by verified email.
   */
  async createGoogleLoginCode(profile: GoogleProfile, deviceId: string) {
    const user = await this.getOrCreateGoogleUser(profile);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
    });
    const code = crypto.randomBytes(32).toString('hex');
    await this.redis.set(
      `auth:google:code:${code}`,
      JSON.stringify({ userId: user.id, deviceId }),
      'EX',
      60,
    );
    return code;
  }

  async exchangeGoogleLoginCode(code: string) {
    const key = `auth:google:code:${code}`;
    const raw = await this.redis.getdel(key);
    if (!raw)
      throw new UnauthorizedException('Mã đăng nhập Google đã hết hạn.');
    const payload = JSON.parse(raw) as { userId: number; deviceId: string };
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      include: { profile: true },
    });
    if (!user || (user.role !== Role.STUDENT && user.role !== Role.ADMIN)) {
      throw new UnauthorizedException('Tài khoản không còn hợp lệ.');
    }
    return this.issueTokens(user, payload.deviceId);
  }

  private async getOrCreateGoogleUser(profile: GoogleProfile) {
    return this.resolveGoogleUser(profile);
  }

  /** Shared account resolution for GIS and Passport OAuth callbacks. */
  private async resolveGoogleUser(profile: GoogleProfile) {
    const linkedAccount = await this.prisma.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: profile.providerId,
        },
      },
      include: { user: { include: { profile: true } } },
    });
    if (linkedAccount?.user) {
      if (
        linkedAccount.user.role !== Role.STUDENT &&
        linkedAccount.user.role !== Role.ADMIN
      ) {
        throw new UnauthorizedException(
          'Tài khoản không có quyền truy cập hệ thống.',
        );
      }
      return linkedAccount.user;
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { profile: true },
    });
    if (existing) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_LINK_REQUIRED',
        message:
          'Email này đã tồn tại trong hệ thống. Hãy xác nhận mật khẩu để liên kết tài khoản Google.',
      });
    }

    const randomPassword = await bcrypt.hash(
      crypto.randomBytes(32).toString('hex'),
      12,
    );
    return this.prisma.user.create({
      data: {
        email: profile.email,
        password: randomPassword,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        profile: {
          create: { fullName: profile.fullName, avatar: profile.avatar },
        },
        authAccounts: {
          create: {
            provider: 'GOOGLE',
            providerAccountId: profile.providerId,
          },
        },
      },
      include: { profile: true },
    });
  }

  private async issueTokens(
    user: { id: number; email: string; role: Role; profile?: unknown },
    deviceId: string,
  ) {
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
    const refresh_token = this.jwtService.sign(
      { sub: user.id, deviceId, type: 'refresh' },
      { expiresIn: '30d' },
    );
    await this.redis.set(
      `user:${user.id}:device:${deviceId}`,
      refresh_token,
      'EX',
      30 * 24 * 60 * 60,
    );
    return {
      access_token,
      refresh_token,
      deviceId,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile,
      },
    };
  }
}
