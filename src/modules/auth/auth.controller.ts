import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Request,
  Res,
  UnauthorizedException,
  ForbiddenException,
  Delete,
  Param,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  GenerateOtpDto,
  VerifyOtpDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  GoogleExchangeDto,
  GoogleLoginDto,
  LinkGoogleAccountDto,
  AcceptConsentDto,
} from './dto/auth.dto';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import * as crypto from 'crypto';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';

/**
 * Per-IP limits on the routes guessing would target (owner 2026-11-14).
 * AUTH_THROTTLE_FACTOR multiplies them for load tests and the QA harness,
 * which register many accounts from one address.
 */
const PER_MINUTE = (limit: number) =>
  Throttle({
    default: {
      limit: limit * Math.max(1, Number(process.env.AUTH_THROTTLE_FACTOR) || 1),
      ttl: 60_000,
    },
  });
import type { Request as ExpressRequest, Response } from 'express';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  csrfProblem,
  readCookie,
  setRefreshCookie,
  deviceIdFrom,
  setDeviceCookie,
} from './auth-cookie';

/**
 * The refresh token goes into the cookie only, never into the JSON body. The
 * device cookie is (re)set with it, so this browser keeps one device id.
 */
function withCookie<
  T extends {
    refresh_token: string | null;
    remember: boolean;
    deviceId?: string;
  },
>(res: Response, result: T) {
  if (result.refresh_token)
    setRefreshCookie(res, result.refresh_token, result.remember);
  if (result.refresh_token && result.deviceId)
    setDeviceCookie(res, result.deviceId);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { refresh_token, ...rest } = result;
  return rest;
}

/** This browser's device id from its bt_dev cookie, or a new one for a browser without it. */
const deviceIdOf = (req: ExpressRequest) =>
  deviceIdFrom(req.headers.cookie) ?? crypto.randomUUID();

const userAgentOf = (req: ExpressRequest) =>
  typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent']
    : null;

/** User-Agent and client IP (TRUST_PROXY decides what req.ip is) for consent evidence. */
const consentMetaOf = (req: ExpressRequest) => ({
  userAgent: userAgentOf(req),
  ip: req.ip ?? null,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @PER_MINUTE(5)
  @ApiOperation({ summary: 'Đăng ký tài khoản học viên mới' })
  @ApiResponse({ status: 201, description: 'Đăng ký thành công.' })
  @ApiResponse({ status: 409, description: 'Email đã tồn tại.' })
  @ApiResponse({
    status: 400,
    description: 'Chưa đồng ý Điều khoản sử dụng và Chính sách bảo mật.',
  })
  async register(
    @Body() registerDto: RegisterDto,
    @Request() req: ExpressRequest,
  ) {
    return this.authService.register(registerDto, consentMetaOf(req));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('consent')
  @ApiOperation({
    summary: 'Lịch sử đồng ý điều khoản và chính sách của tài khoản',
  })
  listConsents(@Request() req: any) {
    return this.authService.listConsents(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('consent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Đồng ý phiên bản hiện hành của Điều khoản sử dụng và Chính sách bảo mật',
  })
  @ApiResponse({ status: 200, description: 'Đã ghi nhận đồng ý.' })
  acceptConsent(@Body() _dto: AcceptConsentDto, @Request() req: any) {
    return this.authService.acceptConsent(req.user.id, consentMetaOf(req));
  }

  @Post('forgot-password')
  @PER_MINUTE(3)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi liên kết đặt lại mật khẩu' })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  @PER_MINUTE(5)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đặt lại mật khẩu bằng token một lần' })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Post('login')
  @PER_MINUTE(10)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập vào hệ thống' })
  @ApiResponse({
    status: 200,
    description: 'Trả về access token và refresh token.',
  })
  @ApiResponse({ status: 401, description: 'Sai tài khoản hoặc mật khẩu.' })
  @ApiResponse({
    status: 403,
    description:
      'ACCOUNT_PENDING_DELETION: tài khoản đang chờ xoá; kèm scheduledAt và cancelToken.',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The same browser signs in again as the same device (bt_dev cookie);
    // its previous session is replaced. The id lives in the tokens.
    return withCookie(
      res,
      await this.authService.login(loginDto, deviceIdOf(req), {
        userAgent: userAgentOf(req),
      }),
    );
  }

  @Post('google')
  @PER_MINUTE(10)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đăng nhập bằng Google Identity Services (ID token)',
  })
  @ApiResponse({
    status: 200,
    description: 'Trả về access token và refresh token.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token không hợp lệ hoặc cần liên kết tài khoản.',
  })
  async googleSignIn(
    @Body() dto: GoogleLoginDto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withCookie(
      res,
      await this.authService.loginWithGoogle(dto, {
        ...consentMetaOf(req),
        deviceId: deviceIdOf(req),
      }),
    );
  }

  @Post('google/link')
  @PER_MINUTE(10)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liên kết tài khoản Google với tài khoản mật khẩu hiện có',
  })
  @ApiResponse({
    status: 200,
    description: 'Liên kết thành công và trả về cặp token.',
  })
  async linkGoogleAccount(
    @Body() dto: LinkGoogleAccountDto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withCookie(
      res,
      await this.authService.linkGoogleWithPassword(dto, {
        userAgent: userAgentOf(req),
        deviceId: deviceIdOf(req),
      }),
    );
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Đăng nhập bằng Google' })
  googleLogin() {
    // Passport performs the redirect to Google.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(@Request() req: any, @Res() res: Response) {
    const deviceId = crypto.randomUUID();
    const code = await this.authService.createGoogleLoginCode(
      req.user,
      deviceId,
    );
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(
      `${frontendUrl}/auth/callback?code=${encodeURIComponent(code)}`,
    );
  }

  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đổi mã Google OAuth lấy JWT phiên đăng nhập' })
  async exchangeGoogleCode(
    @Body() body: GoogleExchangeDto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withCookie(
      res,
      await this.authService.exchangeGoogleLoginCode(
        body.code,
        { ...consentMetaOf(req), deviceId: deviceIdOf(req) },
        body.acceptTerms === true,
      ),
    );
  }

  @Post('refresh')
  @PER_MINUTE(30)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Lấy access token mới từ cookie refresh (cần header X-Requested-With: breadtrans)',
  })
  async refreshTokens(
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csrf = csrfProblem(req.headers);
    if (csrf) throw new ForbiddenException(csrf);
    try {
      return withCookie(
        res,
        await this.authService.refreshTokens(
          readCookie(req.headers.cookie, REFRESH_COOKIE),
        ),
      );
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất khỏi thiết bị hiện tại' })
  async logout(@Request() req: any, @Res({ passthrough: true }) res: Response) {
    clearRefreshCookie(res);
    const deviceId = req.user?.deviceId;
    if (!deviceId) {
      throw new UnauthorizedException(
        'Token thiếu thông tin thiết bị, vui lòng đăng nhập lại.',
      );
    }
    const authorization = req.headers.authorization as string | undefined;
    const accessToken = authorization?.replace(/^Bearer\s+/i, '');
    if (!accessToken) {
      throw new UnauthorizedException('Vui lòng đăng nhập để tiếp tục.');
    }
    return this.authService.logout(req.user.id, deviceId, accessToken);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đổi mật khẩu' })
  @ApiResponse({ status: 200, description: 'Đổi mật khẩu thành công' })
  @ApiResponse({
    status: 400,
    description: 'Mật khẩu hiện tại không đúng hoặc mật khẩu mới không hợp lệ',
  })
  @HttpCode(HttpStatus.OK)
  async changePassword(@Request() req: any, @Body() body: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user.id,
      body.currentPassword,
      body.newPassword,
      req.user.deviceId,
    );
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Các thiết bị đang đăng nhập tài khoản này' })
  listSessions(@Request() req: any) {
    return this.authService.listSessions(req.user.id, req.user.deviceId);
  }

  @Post('sessions/revoke-others')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng xuất mọi thiết bị khác' })
  revokeOtherSessions(@Request() req: any) {
    return this.authService.revokeOtherSessions(req.user.id, req.user.deviceId);
  }

  @Delete('sessions/:deviceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất một thiết bị' })
  revokeSession(@Request() req: any, @Param('deviceId') deviceId: string) {
    return this.authService.revokeSession(req.user.id, deviceId);
  }

  @Post('otp/generate')
  @PER_MINUTE(3)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tạo mã OTP' })
  async generateOtp(@Body() body: GenerateOtpDto) {
    return this.authService.generateOtp(body.email);
  }

  @Post('otp/verify')
  @PER_MINUTE(10)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác thực mã OTP' })
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(body.email, body.otp);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('profile')
  @ApiOperation({
    summary: 'Lấy thông tin tài khoản đang đăng nhập',
  })
  getProfile(@Request() req: any) {
    return req.user;
  }
}
