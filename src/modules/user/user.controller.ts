import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('profile')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết profile của user hiện tại' })
  async getProfile(@Request() req: any) {
    return this.userService.getUserProfile(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('stats')
  @ApiOperation({ summary: 'Lấy thống kê học tập tổng hợp của user hiện tại' })
  async getStats(@Request() req: any) {
    return this.userService.getUserStats(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('profile')
  @ApiOperation({ summary: 'Cập nhật thông tin profile của user hiện tại' })
  async updateProfile(
    @Request() req: any,
    @Body() updateData: UpdateProfileDto,
  ) {
    return this.userService.updateUserProfile(req.user.id, updateData);
  }
}

