import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  GenerateOtpDto,
  VerifyOtpDto,
  VerifyRegistrationDto,
  ChangePasswordDto,
  ActivateTeacherDto,
} from './dto/auth.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import * as crypto from 'crypto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản học viên mới' })
  @ApiResponse({ status: 201, description: 'Đăng ký thành công.' })
  @ApiResponse({ status: 409, description: 'Email đã tồn tại.' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  async verifyRegistration(@Body() body: VerifyRegistrationDto) {
    return this.authService.verifyRegistration(body.email, body.otp);
  }
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập vào hệ thống' })
  @ApiResponse({
    status: 200,
    description: 'Trả về access token và refresh token.',
  })
  @ApiResponse({ status: 401, description: 'Sai tài khoản hoặc mật khẩu.' })
  async login(@Body() loginDto: LoginDto) {
    // If client doesn't provide a deviceId, generate a temporary one
    const deviceId = loginDto.deviceId || crypto.randomUUID();
    return this.authService.login(loginDto, deviceId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy token mới bằng Refresh Token' })
  async refreshTokens(@Request() req: any, @Body() body: RefreshTokenDto) {
    let userId: number | null = null;

    // Try extracting userId from Authorization header if passed
    const authHeader = req.headers.authorization as string;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded: any = this.authService['jwtService'].decode(token);
      if (decoded && decoded.sub) {
        userId = decoded.sub;
      }
    }

    return this.authService.refreshTokens(
      userId as any,
      body.deviceId,
      body.refreshToken,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất khỏi thiết bị hiện tại' })
  async logout(@Request() req: any) {
    const deviceId = req.user?.deviceId;
    if (!deviceId) {
      throw new UnauthorizedException(
        'Token thiếu thông tin thiết bị, vui lòng đăng nhập lại.',
      );
    }
    const authorization = req.headers.authorization as string | undefined;
    const accessToken = authorization?.replace(/^Bearer\s+/i, '');
    if (!accessToken) {
      throw new UnauthorizedException('Access token is required.');
    }
    return this.authService.logout(req.user.id, deviceId, accessToken);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async changePassword(@Request() req: any, @Body() body: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user.id,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Post('activate-teacher')
  @HttpCode(HttpStatus.OK)
  async activateTeacher(@Body() body: ActivateTeacherDto) {
    return this.authService.activateTeacher(body.token, body.newPassword);
  }
  @Post('otp/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tạo mã OTP' })
  async generateOtp(@Body() body: GenerateOtpDto) {
    return this.authService.generateOtp(body.email);
  }

  @Post('otp/verify')
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
