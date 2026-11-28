import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
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
import { LoginGuard, OTP_MAX_ATTEMPTS } from './login-guard';
import {
  CONSENT_REQUIRED_CODE,
  CONSENT_REQUIRED_MESSAGE,
  LEGAL_VERSION,
  consentRequired,
  consentRows,
} from './legal-consent';
import {
  CANCEL_TOKEN_TTL_SECONDS,
  PENDING_DELETION_CODE,
  cancelTokenKey,
} from '../account/account-deletion.logic';

/** What the controller knows about the device signing in. */
export type DeviceMeta = {
  userAgent?: string | null;
  remember?: boolean;
  /** Client IP, recorded with a consent. */
  ip?: string | null;
  /** This browser's device id (bt_dev cookie), reused across sign-ins. */
  deviceId?: string;
};
import { Prisma, Role } from '@prisma/client';
import { GoogleProfile } from './strategies/google.strategy';
import { OAuth2Client } from 'google-auth-library';
import { EmailService } from '../../common/email/email.service';
import { passwordChangedEmail } from '../../common/email/email-templates';

/**
 * Two sign-ups with one e-mail at once (a double submit, two tabs) both pass
 * the check above; the second create hits the unique e-mail (audit A14,
 * 2026-11-18): 409, as for an e-mail already taken.
 */
function emailTaken(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    throw new ConflictException('Email này đã được đăng ký.');
  throw error;
}

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
    this.loginGuard = new LoginGuard(redis);
  }

  private readonly loginGuard: LoginGuard;

  /** Refresh sessions per device (hashed tokens, a set per user). */
  readonly sessions: AuthSessionStore;

  async register(registerDto: RegisterDto, meta: DeviceMeta = {}) {
    const { email, password, fullName } = registerDto;
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) throw new ConflictException('Email này đã được đăng ký.');
    const hashedPassword = await bcrypt.hash(password, 12);
    // The DTO requires acceptTerms === true; the acceptance is stored with the
    // account, in the same write (owner 2026-11-16).
    const user = await this.prisma.user
      .create({
        data: {
          email,
          password: hashedPassword,
          role: Role.STUDENT,
          emailVerifiedAt: new Date(),
          profile: { create: { fullName } },
          consents: { create: consentRows('EMAIL_SIGNUP', meta) },
        },
        include: { profile: true },
      })
      .catch(emailTaken);
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

    const resetUrl = await this.issuePasswordResetUrl(user.id);
    try {
      await this.emailService.sendPasswordResetEmail(email, resetUrl);
    } catch (error) {
      this.logger.error(`Password reset email failed for ${email}`, error);
    }

    return genericResponse;
  }

  /**
   * An admin sends a learner the reset link from the user form (owner
   * 2026-11-28: the admin no longer types a password for someone else). Same
   * token as the learner's own request: stored as a hash, one use, 15 minutes,
   * one live token per user, one request a minute per address. The admin gets
   * the outcome, which the learner's request hides on purpose.
   */
  async sendPasswordResetForAdmin(userId: number): Promise<{
    status: 'SENT' | 'COOLDOWN' | 'UNDELIVERABLE' | 'EMAIL_FAILED';
    email: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('Người dùng không tồn tại');
    const email = user.email.trim().toLowerCase();
    // A test domain never receives mail: say so instead of issuing a token.
    if (!this.emailService.canDeliver(email))
      return { status: 'UNDELIVERABLE', email: user.email };
    const accepted = await this.redis.set(
      `auth:password-reset:cooldown:${email}`,
      '1',
      'EX',
      60,
      'NX',
    );
    if (accepted !== 'OK') return { status: 'COOLDOWN', email: user.email };
    const resetUrl = await this.issuePasswordResetUrl(user.id);
    try {
      await this.emailService.sendPasswordResetEmail(email, resetUrl);
    } catch (error) {
      this.logger.error(
        `Admin password reset email failed for ${email}`,
        error,
      );
      return { status: 'EMAIL_FAILED', email: user.email };
    }
    this.logger.log(`admin_password_reset_sent user=${user.id}`);
    return { status: 'SENT', email: user.email };
  }

  /** A fresh single-use reset token for the user (the old one stops working); returns the link. */
  private async issuePasswordResetUrl(userId: number): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const tokenKey = `auth:password-reset:token:${tokenHash}`;
    const userTokenKey = `auth:password-reset:user:${userId}`;
    const previousTokenHash = await this.redis.get(userTokenKey);
    if (previousTokenHash) {
      await this.redis.del(`auth:password-reset:token:${previousTokenHash}`);
    }

    const ttlSeconds = 15 * 60;
    await this.redis.set(tokenKey, String(userId), 'EX', ttlSeconds);
    await this.redis.set(userTokenKey, tokenHash, 'EX', ttlSeconds);

    const frontendUrl = (
      process.env.FRONTEND_URL || 'http://localhost:3000'
    ).replace(/\/$/, '');
    return `${frontendUrl}/reset-password?token=${rawToken}`;
  }

  /**
   * Whether a reset link can still be used, without using it. Same conditions
   * as resetPassword (the token is known and is the user's current one), but
   * read-only: a mail scanner or a page that only looks leaves the link alive.
   */
  async isPasswordResetTokenValid(rawToken: string): Promise<boolean> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const rawUserId = await this.redis.get(
      `auth:password-reset:token:${tokenHash}`,
    );
    if (!rawUserId) return false;
    const currentTokenHash = await this.redis.get(
      `auth:password-reset:user:${Number(rawUserId)}`,
    );
    return currentTokenHash === tokenHash;
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
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { password, mustChangePassword: false },
      select: { email: true },
    });
    forgetAuthUser(userId);
    await this.redis.del(userTokenKey);

    // After the new hash is saved: a sign-in that read the old one sees it.
    await this.sessions.markPasswordChanged(userId);
    // Every device, and every access token it still holds.
    await this.sessions.revokeAll(userId);
    void this.noticePasswordChanged(updated?.email, 'all');

    return { message: 'Đặt lại mật khẩu thành công.' };
  }

  /**
   * Security notice after a password change (owner 2026-11-21). Sent in the
   * background: a mail failure never fails the change.
   */
  private async noticePasswordChanged(
    to: string | undefined,
    signedOut: 'all' | 'others',
  ) {
    if (!to) return;
    try {
      await this.emailService.sendPasswordChanged(
        to,
        passwordChangedEmail({
          changedAt: new Date(),
          signedOut,
          appUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
        }),
      );
    } catch (error) {
      this.logger.warn(`password_changed_email_failed: ${String(error)}`);
    }
  }
  async login(loginDto: LoginDto, deviceId: string, meta: DeviceMeta = {}) {
    const { email, password } = loginDto;
    await this.loginGuard.assertAllowed(email);
    const startedAt = Date.now();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    const isPasswordValid =
      !!user?.password && (await bcrypt.compare(password, user.password));
    if (!user || !isPasswordValid) {
      await this.loginGuard.recordFailure(email);
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác.');
    }
    await this.loginGuard.recordSuccess(email);
    await this.assertNotPendingDeletion(user);

    // Update login count and last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    });

    return this.issueTokensUnlessPasswordChanged(
      user,
      deviceId,
      { userAgent: meta.userAgent, remember: loginDto.rememberMe ?? false },
      startedAt,
    );
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
    if (!user || user.deletionRequestedAt || user.anonymizedAt) throw invalid();

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
        consentRequired: await this.consentRequiredFor(user.id),
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
    const sent = {
      message:
        process.env.NODE_ENV === 'production'
          ? 'Nếu email có tài khoản, mã OTP đã được gửi.'
          : 'Nếu email có tài khoản, mã OTP đã được gửi (xem console ở môi trường DEV).',
    };
    // The same answer for every e-mail: it must not tell who is registered.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return sent;

    // Cryptographically secure 6-digit OTP (100000 to 999999 inclusive)
    const otp = crypto.randomInt(100000, 1000000).toString();

    // Hash it before storing in Redis so even if Redis is breached, OTP is safe
    const secret = getOtpSecret();
    const hash = crypto.createHmac('sha256', secret).update(otp).digest('hex');

    const redisKey = `otp:${email}`;
    await this.redis.set(redisKey, hash, 'EX', 300); // 5 mins TTL
    await this.redis.del(`otp:attempts:${email}`);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV MODE ONLY] OTP for ${email}: ${otp}`);
    }

    return sent;
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
      const attemptsKey = `otp:attempts:${email}`;
      const attempts = await this.redis.incr(attemptsKey);
      if (attempts === 1) await this.redis.expire(attemptsKey, 300);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        // Too many guesses: the code is gone, a new one must be requested.
        await this.redis.del(redisKey, attemptsKey);
        throw new UnauthorizedException(
          'Nhập sai mã OTP quá nhiều lần. Hãy yêu cầu mã mới.',
        );
      }
      throw new UnauthorizedException('Mã OTP không chính xác.');
    }

    // Single-use: Destroy OTP
    await this.redis.del(redisKey, `otp:attempts:${email}`);
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
    await this.sessions.markPasswordChanged(userId);
    // Someone holding another session must not keep it (owner 2026-11-14).
    const signedOut = await this.sessions.revokeAll(userId, currentDeviceId);
    void this.noticePasswordChanged(
      user.email,
      currentDeviceId ? 'others' : 'all',
    );
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
    // The browser's own device id first, so signing in again replaces its session.
    const deviceId = meta.deviceId ?? dto.deviceId ?? crypto.randomUUID();

    const profile = { providerId: googleSub, email, fullName, avatar };
    const user =
      (await this.findGoogleUser(profile)) ??
      (await this.createGoogleUser(profile, dto.acceptTerms === true, meta));
    await this.assertNotPendingDeletion(user);
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

    const startedAt = Date.now();
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

    // The browser's own device id first, so signing in again replaces its session.
    const deviceId = meta.deviceId ?? dto.deviceId ?? crypto.randomUUID();
    await this.assertNotPendingDeletion(user);

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

    return this.issueTokensUnlessPasswordChanged(
      user,
      deviceId,
      { ...meta, remember: true },
      startedAt,
    );
  }

  /**
   * Google is an identity provider, not a role provider. New accounts are
   * always STUDENT and existing email accounts are linked by verified email.
   */
  async createGoogleLoginCode(profile: GoogleProfile, deviceId: string) {
    // An unknown Google account is not created here: the learner has not
    // consented yet. The code carries the profile; the exchange creates the
    // account once the consent box was ticked (owner 2026-11-16).
    const user = await this.findGoogleUser(profile);
    if (user)
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
      });
    const code = crypto.randomBytes(32).toString('hex');
    await this.redis.set(
      `auth:google:code:${code}`,
      JSON.stringify(
        user ? { userId: user.id, deviceId } : { pending: profile, deviceId },
      ),
      'EX',
      60,
    );
    return code;
  }

  async exchangeGoogleLoginCode(
    code: string,
    meta: DeviceMeta = {},
    acceptTerms = false,
  ) {
    const key = `auth:google:code:${code}`;
    const raw = await this.redis.getdel(key);
    if (!raw)
      throw new UnauthorizedException('Mã đăng nhập Google đã hết hạn.');
    const payload = JSON.parse(raw) as {
      userId?: number;
      pending?: GoogleProfile;
      deviceId: string;
    };
    if (payload.pending) {
      if (!acceptTerms) {
        // Kept for a few minutes so the learner can tick the box and resend.
        await this.redis.set(key, raw, 'EX', 300);
        throw new ConflictException({
          code: CONSENT_REQUIRED_CODE,
          message: CONSENT_REQUIRED_MESSAGE,
        });
      }
      const created = await this.createGoogleUser(payload.pending, true, meta);
      return this.issueTokens(created, meta.deviceId ?? payload.deviceId, {
        ...meta,
        remember: true,
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      include: { profile: true },
    });
    if (!user || (user.role !== Role.STUDENT && user.role !== Role.ADMIN)) {
      throw new UnauthorizedException('Tài khoản không còn hợp lệ.');
    }
    await this.assertNotPendingDeletion(user);
    // The callback was a redirect from Google, which carries no Strict cookie;
    // this exchange does, so the browser's device id wins over the one made then.
    return this.issueTokens(user, meta.deviceId ?? payload.deviceId, {
      ...meta,
      remember: true,
    });
  }

  /**
   * A new account from a Google profile, only with consent: without it,
   * 409 CONSENT_REQUIRED and nothing is created.
   */
  private async createGoogleUser(
    rawProfile: GoogleProfile,
    acceptTerms: boolean,
    meta: DeviceMeta,
  ) {
    if (!acceptTerms)
      throw new ConflictException({
        code: CONSENT_REQUIRED_CODE,
        message: CONSENT_REQUIRED_MESSAGE,
      });
    const profile = {
      ...rawProfile,
      email: rawProfile.email.trim().toLowerCase(),
    };
    // No password: the learner never chose one. Password login stays closed
    // (it rejects a null password) until they set one via "Quên mật khẩu",
    // and the account page hides "Đổi mật khẩu" while it is null.
    return this.prisma.user
      .create({
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
          consents: { create: consentRows('GOOGLE_SIGNUP', meta) },
        },
        include: { profile: true },
      })
      .catch(emailTaken);
  }

  /**
   * The account a Google profile signs in to, or null when none exists yet.
   * Shared by GIS and the Passport callback. An e-mail already used by a
   * password account asks for linking instead.
   */
  private async findGoogleUser(rawProfile: GoogleProfile) {
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
    return null;
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
  /**
   * A sign-in that checked the password it read from `startedAt` on. If the
   * password changed since, the new session is ended and the sign-in refused
   * (audit A2, 2026-11-18). The check runs after the session exists: either
   * it sees the change, or the change's revokeAll sees the session.
   */
  private async issueTokensUnlessPasswordChanged(
    user: { id: number; email: string; role: Role; profile?: unknown },
    deviceId: string,
    meta: DeviceMeta,
    startedAt: number,
  ) {
    const issued = await this.issueTokens(user, deviceId, meta);
    if (await this.sessions.passwordChangedSince(user.id, startedAt)) {
      await this.sessions.revoke(user.id, deviceId);
      throw new UnauthorizedException(
        'Mật khẩu vừa được đổi. Vui lòng đăng nhập lại bằng mật khẩu mới.',
      );
    }
    return issued;
  }

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
        consentRequired: await this.consentRequiredFor(user.id),
      },
    };
  }

  /**
   * A sign-in that proved who the user is, on an account waiting for
   * deletion: 403 ACCOUNT_PENDING_DELETION with the date and a one-time
   * cancel token, no session (owner 2026-11-16).
   */
  private async assertNotPendingDeletion(user: {
    id: number;
    deletionRequestedAt?: Date | null;
    deletionScheduledAt?: Date | null;
    anonymizedAt?: Date | null;
  }) {
    if (user.anonymizedAt)
      throw new UnauthorizedException('Tài khoản không còn hợp lệ.');
    if (!user.deletionRequestedAt) return;
    const cancelToken = crypto.randomBytes(24).toString('hex');
    await this.redis.set(
      cancelTokenKey(cancelToken),
      String(user.id),
      'EX',
      CANCEL_TOKEN_TTL_SECONDS,
    );
    throw new ForbiddenException({
      code: PENDING_DELETION_CODE,
      message: 'Tài khoản đang chờ xoá. Bạn có thể huỷ yêu cầu xoá.',
      scheduledAt: user.deletionScheduledAt?.toISOString() ?? null,
      cancelToken,
    });
  }

  /** Whether the user still has to accept the current terms and privacy policy. */
  async consentRequiredFor(userId: number): Promise<boolean> {
    const consents = await this.prisma.userConsent.findMany({
      where: { userId, version: LEGAL_VERSION },
      select: { document: true, version: true },
    });
    return consentRequired(consents ?? []);
  }

  /** Records consent given after sign-up (older account or new documents). */
  async acceptConsent(userId: number, meta: DeviceMeta = {}) {
    if (await this.consentRequiredFor(userId))
      // Checked again under a per-user lock (audit A15, 2026-11-18): two
      // accepts at once (double click, two tabs) both read "required" and
      // each wrote both documents.
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consent:${userId}`}, 0))`;
        const consents = await tx.userConsent.findMany({
          where: { userId, version: LEGAL_VERSION },
          select: { document: true, version: true },
        });
        if (!consentRequired(consents)) return;
        await tx.userConsent.createMany({
          data: consentRows('PROMPT', meta).map((row) => ({ ...row, userId })),
        });
      });
    return { consentRequired: false, version: LEGAL_VERSION };
  }

  /** The user's own consent history, newest first. */
  async listConsents(userId: number) {
    const rows = await this.prisma.userConsent.findMany({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
      select: { document: true, version: true, method: true, acceptedAt: true },
    });
    return {
      currentVersion: LEGAL_VERSION,
      consentRequired: consentRequired(rows),
      consents: rows,
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
