import {
  BadRequestException,
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
import { forgetAuthUser } from './auth-user-cache';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_SECONDS,
  getJwtRefreshSecret,
  getOtpSecret,
} from './auth.constants';
import { AuthSessionStore } from './session-store';

/** What the controller knows about the device signing in. */
export type DeviceMeta = { userAgent?: string | null; remember?: boolean };
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
  ) {
    this.sessions = new AuthSessionStore(redis);
  }

  /** Refresh sessions per device (hashed tokens, a set per user). */
  readonly sessions: AuthSessionStore;

  async register(registerDto: RegisterDto) {
    const { email, password, fullName } = registerDto;
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) throw new ConflictException('Email này đã được đăng ký.');
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
      throw new UnauthorizedException(
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
      );
    }

    const userId = Number(rawUserId);
    const userTokenKey = `auth:password-reset:user:${userId}`;
    const currentTokenHash = await this.redis.get(userTokenKey);
    if (currentTokenHash !== tokenHash) {
      throw new UnauthorizedException(
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
      );
    }

    const password = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password, mustChangePassword: false },
    });
    forgetAuthUser(userId);
    await this.redis.del(userTokenKey);

    // Every device, and every access token it still holds.
    await this.sessions.revokeAll(userId);

    return { message: 'Đặt lại mật khẩu thành công.' };
  }
  async login(loginDto: LoginDto, deviceId: string, meta: DeviceMeta = {}) {
    const { email, password } = loginDto;
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    if (!user || !user.password)
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác.');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác.');

    // Update login count and last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    });

    return this.issueTokens(user, deviceId, {
      userAgent: meta.userAgent,
      remember: loginDto.rememberMe ?? false,
    });
  }

  /**
   * Renews the access token from the refresh cookie. The current refresh
   * token rotates; the one just rotated out (another tab) renews without
   * rotating for a few seconds; any older one revokes the device.
   */
  async refreshTokens(providedRefreshToken: string | null) {
    const invalid = () =>
      new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      );
    if (!providedRefreshToken) throw invalid();
    let payload: { sub?: number; deviceId?: string; type?: string };
    try {
      payload = this.jwtService.verify(providedRefreshToken, {
        secret: getJwtRefreshSecret(),
      });
    } catch {
      throw invalid();
    }
    if (payload?.type !== 'refresh' || !payload.sub || !payload.deviceId)
      throw invalid();
    const userId = payload.sub;
    const deviceId = payload.deviceId;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw invalid();

    const next = this.signRefresh(user.id, deviceId);
    const result = await this.sessions.rotate(
      userId,
      deviceId,
      providedRefreshToken,
      next,
    );
    if (result.kind === 'REUSED')
      this.logger.warn(
        `Refresh token reuse for user ${userId} device ${deviceId}: session revoked`,
      );
    if (result.kind === 'REUSED' || result.kind === 'MISSING') throw invalid();

    return {
      access_token: this.signAccess(user, deviceId),
      // Only a real rotation sets a new cookie; a grace renewal keeps the
      // cookie the other tab just received.
      refresh_token: result.kind === 'ROTATED' ? next : null,
      remember: result.session.remember,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile,
      },
    };
  }

  async logout(userId: number, deviceId: string, accessToken: string) {
    await this.sessions.revoke(userId, deviceId);
    const tokenHash = crypto
      .createHash('sha256')
      .update(accessToken)
      .digest('hex');
    const decoded = this.jwtService.decode(accessToken);
    const remainingTtl = Math.max(
      1,
      (decoded?.exp ?? Math.floor(Date.now() / 1000) + 3600) -
        Math.floor(Date.now() / 1000),
    );
    await this.redis.set(
      `jwt:denylist:${tokenHash}`,
      'revoked',
      'EX',
      remainingTtl,
    );
    return { message: 'Đăng xuất thành công.' };
  }

  // ================= HMAC-SHA256 OTP =================

  async generateOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Không tìm thấy tài khoản.');

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
          ? 'Đã gửi mã OTP.'
          : 'Đã gửi mã OTP (xem console ở môi trường DEV).',
    };
  }

  async verifyOtp(email: string, providedOtp: string) {
    const redisKey = `otp:${email}`;
    const storedHash = await this.redis.get(redisKey);
    if (!storedHash)
      throw new UnauthorizedException('Mã OTP không hợp lệ hoặc đã hết hạn.');

    const secret = getOtpSecret();
    const computedHash = crypto
      .createHmac('sha256', secret)
      .update(providedOtp)
      .digest('hex');

    if (storedHash !== computedHash) {
      throw new UnauthorizedException('Mã OTP không chính xác.');
    }

    // Single-use: Destroy OTP
    await this.redis.del(redisKey);
    return { message: 'Xác thực OTP thành công.' };
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    currentDeviceId?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(currentPassword, user.password))
    )
      // 400, not 401: the session is valid, only the typed password is wrong.
      // A 401 here makes the client refresh its token on every typo.
      throw new BadRequestException('Mật khẩu hiện tại không đúng.');

    const password = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password, mustChangePassword: false },
    });
    forgetAuthUser(userId);
    // Someone holding another session must not keep it (owner 2026-11-14).
    const signedOut = await this.sessions.revokeAll(userId, currentDeviceId);
    return { message: 'Đổi mật khẩu thành công.', signedOutDevices: signedOut };
  }

  /**
   * Google Identity Services (GIS) Sign-In verification & issue tokens.
   * New users are strictly Role.STUDENT.
   * If email matches existing password account, throw ACCOUNT_LINK_REQUIRED.
   */
  async loginWithGoogle(dto: GoogleLoginDto, meta: DeviceMeta = {}) {
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
    return this.issueTokens(user, deviceId, { ...meta, remember: true });
  }

  /**
   * Liên kết tài khoản Google với tài khoản đã tồn tại qua xác nhận mật khẩu.
   */
  async linkGoogleWithPassword(
    dto: LinkGoogleAccountDto,
    meta: DeviceMeta = {},
  ) {
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

    return this.issueTokens(user, deviceId, { ...meta, remember: true });
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

  async exchangeGoogleLoginCode(code: string, meta: DeviceMeta = {}) {
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
    return this.issueTokens(user, payload.deviceId, {
      ...meta,
      remember: true,
    });
  }

  private async getOrCreateGoogleUser(profile: GoogleProfile) {
    return this.resolveGoogleUser(profile);
  }

  /** Shared account resolution for GIS and Passport OAuth callbacks. */
  private async resolveGoogleUser(rawProfile: GoogleProfile) {
    // Same e-mail key as password accounts (see NormalizeEmail).
    const profile = {
      ...rawProfile,
      email: rawProfile.email.trim().toLowerCase(),
    };
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

    // No password: the learner never chose one. Password login stays closed
    // (it rejects a null password) until they set one via "Quên mật khẩu",
    // and the account page hides "Đổi mật khẩu" while it is null.
    return this.prisma.user.create({
      data: {
        email: profile.email,
        password: null,
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

  private signAccess(
    user: { id: number; email: string; role: Role },
    deviceId: string,
  ) {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        deviceId,
        type: 'access',
        jti: crypto.randomUUID(),
      },
      { expiresIn: ACCESS_TOKEN_TTL as any },
    );
  }

  private signRefresh(userId: number, deviceId: string) {
    return this.jwtService.sign(
      { sub: userId, deviceId, type: 'refresh', jti: crypto.randomUUID() },
      { secret: getJwtRefreshSecret(), expiresIn: REFRESH_TOKEN_TTL_SECONDS },
    );
  }

  /** A new device session: access token, refresh token (for the cookie) and the user. */
  private async issueTokens(
    user: { id: number; email: string; role: Role; profile?: unknown },
    deviceId: string,
    meta: DeviceMeta = {},
  ) {
    const access_token = this.signAccess(user, deviceId);
    const refresh_token = this.signRefresh(user.id, deviceId);
    const remember = meta.remember ?? true;
    await this.sessions.create(user.id, deviceId, refresh_token, {
      userAgent: meta.userAgent ?? null,
      remember,
    });
    return {
      access_token,
      refresh_token,
      remember,
      deviceId,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile,
      },
    };
  }

  /** The account's signed-in devices for the devices page. */
  async listSessions(userId: number, currentDeviceId?: string) {
    const sessions = await this.sessions.list(userId);
    return sessions
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((s) => ({
        deviceId: s.deviceId,
        userAgent: s.userAgent,
        createdAt: new Date(s.createdAt).toISOString(),
        lastUsedAt: new Date(s.lastUsedAt).toISOString(),
        current: s.deviceId === currentDeviceId,
      }));
  }

  async revokeSession(userId: number, deviceId: string) {
    const exists = await this.sessions.get(userId, deviceId);
    if (!exists) throw new BadRequestException('Không tìm thấy thiết bị này.');
    await this.sessions.revoke(userId, deviceId);
    return { revoked: true };
  }

  async revokeOtherSessions(userId: number, currentDeviceId: string) {
    return {
      revoked: await this.sessions.revokeAll(userId, currentDeviceId),
    };
  }
}
