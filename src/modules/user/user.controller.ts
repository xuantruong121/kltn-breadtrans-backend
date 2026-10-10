import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateShippingProfileDto } from './dto/update-shipping-profile.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdaptiveDailyPracticeService } from './adaptive-daily-practice.service';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly adaptiveDailyPractice: AdaptiveDailyPracticeService,
  ) {}

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
  @Get('skills-summary')
  @ApiOperation({
    summary: 'Lấy tiến độ và thống kê 4 kỹ năng chuyên sâu của user hiện tại',
  })
  async getSkillsSummary(@Request() req: any) {
    return this.userService.getUserSkillsSummary(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me/skill-progress')
  @ApiOperation({
    summary: 'Lấy tiến độ server-owned của bốn kỹ năng học tập',
  })
  async getSkillProgress(@Request() req: any) {
    return this.userService.getSkillProgressSummary(req.user.id, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me/daily-practice')
  @ApiOperation({
    summary: 'Lấy kế hoạch luyện tập hôm nay theo tiến độ thực tế',
  })
  async getDailyPractice(@Request() req: any) {
    return this.adaptiveDailyPractice.getDailyPractice(
      req.user.id,
      req.user.role,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('learning-history')
  @ApiOperation({
    summary: 'Lấy lịch sử luyện tập đã được lưu của user hiện tại',
  })
  getLearningHistory(
    @Request() req: { user: { id: number } },
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.userService.getLearningHistory(
      req.user.id,
      type,
      Number(limit) || 50,
    );
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

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('shipping-profile')
  @ApiOperation({
    summary: 'Lấy thông tin địa chỉ giao hàng / nhận quà của user hiện tại',
  })
  async getShippingProfile(@Request() req: any) {
    return this.userService.getShippingProfile(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('shipping-profile')
  @ApiOperation({
    summary:
      'Cập nhật thông tin địa chỉ giao hàng / nhận quà của user hiện tại',
  })
  async updateShippingProfile(
    @Request() req: any,
    @Body() dto: UpdateShippingProfileDto,
  ) {
    return this.userService.updateShippingProfile(req.user.id, dto);
  }
}
