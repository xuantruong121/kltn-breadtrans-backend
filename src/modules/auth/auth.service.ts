import {
  Injectable,
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
import { EmailService } from '../../common/email/email.service';
import { GoogleProfile } from './strategies/google.strategy';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class AuthService {
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
    await this.redis.set(
      `register:pending:${email}`,
      JSON.stringify({ email, fullName, password: hashedPassword }),
      'EX',
      600,
    );
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto
      .createHmac('sha256', getOtpSecret())
      .update(otp)
      .digest('hex');
    await this.redis.set(`register:otp:${email}`, otpHash, 'EX', 300);
    await this.redis.del(`register:otp:attempts:${email}`);
    await this.emailService.sendRegistrationOtp(email, otp);
    return {
      message: 'Registration started. Verify the OTP sent to your email.',
    };
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

  async verifyRegistration(email: string, providedOtp: string) {
    const pendingRaw = await this.redis.get(`register:pending:${email}`);
    if (!pendingRaw)
      throw new UnauthorizedException('Registration expired or invalid');
    const otpKey = `register:otp:${email}`;
    const storedHash = await this.redis.get(otpKey);
    if (!storedHash) throw new UnauthorizedException('OTP expired or invalid');
    const attempts = await this.redis.incr(`register:otp:attempts:${email}`);
    await this.redis.expire(`register:otp:attempts:${email}`, 300);
    if (attempts > 5) {
      await this.redis.del(`register:pending:${email}`, otpKey);
      throw new UnauthorizedException('Too many invalid OTP attempts');
    }
    const computedHash = crypto
      .createHmac('sha256', getOtpSecret())
      .update(providedOtp)
      .digest('hex');
    if (storedHash !== computedHash)
      throw new UnauthorizedException('Invalid OTP');
    const pending = JSON.parse(pendingRaw) as {
      email: string;
      fullName: string;
      password: string;
    };
    const user = await this.prisma.user.create({
      data: {
        email: pending.email,
        password: pending.password,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        profile: { create: { fullName: pending.fullName } },
      },
      include: { profile: true },
    });
    await this.redis.del(
      `register:pending:${email}`,
      otpKey,
      `register:otp:attempts:${email}`,
    );
    const { password, ...safeUser } = user;
    void password;
    return safeUser;
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

    // 1. Kiểm tra AuthAccount đã liên kết với Google Sub này chưa
    const authAccount = await (this.prisma as any).authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: googleSub,
        },
      },
      include: {
        user: {
          include: { profile: true },
        },
      },
    });

    if (authAccount?.user) {
      const user = authAccount.user;
      if (user.role !== Role.STUDENT && user.role !== Role.ADMIN) {
        throw new UnauthorizedException(
          'Tài khoản không có quyền truy cập hệ thống.',
        );
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
      });
      return this.issueTokens(user, deviceId);
    }

    // 2. Nếu chưa có AuthAccount, kiểm tra xem email đã tồn tại trong bảng User chưa
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (existingUser) {
      // Chính sách an toàn: Không tự động liên kết với tài khoản mật khẩu đang tồn tại.
      throw new UnauthorizedException({
        code: 'ACCOUNT_LINK_REQUIRED',
        message:
          'Email này đã tồn tại trong hệ thống. Hãy xác nhận mật khẩu để liên kết tài khoản Google.',
      });
    }

    // 3. Tạo User mới (LUÔN LUÔN Role.STUDENT) kèm AuthAccount
    const newUser = await (this.prisma as any).user.create({
      data: {
        email,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
        loginCount: 1,
        profile: {
          create: {
            fullName,
            avatar,
          },
        },
        authAccounts: {
          create: {
            provider: 'GOOGLE',
            providerAccountId: googleSub,
          },
        },
      },
      include: { profile: true },
    });

    return this.issueTokens(newUser, deviceId);
  }

  /**
   * Liên kết tài khoản Google với tài khoản đã tồn tại qua xác nhận mật khẩu.
   */
  async linkGoogleWithPassword(dto: LinkGoogleAccountDto) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new ServiceUnavailableException('Google Client ID chưa được cấu hình.');
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
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Mật khẩu không chính xác.');
    }

    const deviceId = dto.deviceId || crypto.randomUUID();

    await (this.prisma as any).authAccount.upsert({
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
    const raw = await this.redis.get(key);
    if (!raw)
      throw new UnauthorizedException('Mã đăng nhập Google đã hết hạn.');
    await this.redis.del(key);
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
    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { profile: true },
    });
    if (existing) {
      if (!existing.profile) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: {
            profile: {
              create: { fullName: profile.fullName, avatar: profile.avatar },
            },
          },
          include: { profile: true },
        });
      }
      return existing;
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
