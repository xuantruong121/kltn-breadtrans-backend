import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

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
  @ApiResponse({ status: 200, description: 'Trả về access token.' })
  @ApiResponse({ status: 401, description: 'Sai tài khoản hoặc mật khẩu.' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('profile')
  @ApiOperation({
    summary: 'Lấy thông tin tài khoản đang đăng nhập (Test JWT)',
  })
  getProfile(@Request() req: any) {
    return req.user;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cấp lại Access Token mới bằng Refresh Token' })
  @ApiResponse({ status: 200, description: 'Trả về token mới.' })
  @ApiResponse({ status: 401, description: 'Refresh Token không hợp lệ.' })
  async refreshTokens(
    @Body('userId') userId: number,
    @Body('refreshToken') refreshToken: string,
  ) {
    return this.authService.refreshTokens(userId, refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng xuất, xóa refresh token' })
  async logout(@Request() req: any) {
    return this.authService.logout(req.user.id);
  }
}
