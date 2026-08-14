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
    const authHeader = req.headers.authorization;
    if (!authHeader) throw new UnauthorizedException('Missing token');
    const token = authHeader.split(' ')[1];
    
    // Use decode (not verify) to get payload even if expired
    const decoded = this.authService['jwtService'].decode(token) as any;
    if (!decoded || !decoded.sub) throw new UnauthorizedException('Invalid token');

    return this.authService.refreshTokens(
      decoded.sub,
      body.deviceId,
      body.refreshToken,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất khỏi thiết bị hiện tại' })
  async logout(@Request() req: any, @Body('deviceId') deviceId: string) {
    return this.authService.logout(req.user.id, deviceId);
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
