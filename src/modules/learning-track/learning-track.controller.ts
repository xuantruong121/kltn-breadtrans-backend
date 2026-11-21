import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateLearningTrackDto,
  ReorderLearningTracksDto,
  UpdateLearningTrackDto,
} from './dto/learning-track.dto';
import { LearningTrackService } from './learning-track.service';

const ADMIN_ROW =
  '{ code, name, description, sortOrder, isActive, isSystem, usage: { listening, reading, writing, speaking, learners } }';

/** The active tracks, for onboarding, the goal editor and tag pickers. */
@ApiTags('Learning Tracks')
@Controller('learning-tracks')
export class LearningTrackController {
  constructor(private readonly tracks: LearningTrackService) {}

  @Get()
  @ApiOperation({
    summary:
      'Các lĩnh vực đang bật, theo thứ tự admin xếp (không cần đăng nhập)',
  })
  @ApiResponse({
    status: 200,
    description: '[{ code, name, description, sortOrder }]',
  })
  list() {
    return this.tracks.listActive();
  }
}

@ApiTags('Admin Learning Tracks')
@ApiBearerAuth()
@Controller('admin/learning-tracks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminLearningTrackController {
  constructor(private readonly tracks: LearningTrackService) {}

  @Get()
  @ApiOperation({
    summary:
      '[Admin] Mọi lĩnh vực, cả lĩnh vực đã tắt, kèm số bài theo kỹ năng và số học viên chọn',
  })
  @ApiResponse({ status: 200, description: `[${ADMIN_ROW}]` })
  list() {
    return this.tracks.listForAdmin();
  }

  @Post()
  @ApiOperation({
    summary:
      '[Admin] Thêm lĩnh vực; mã tạo từ tên khi bỏ trống, xếp trước lĩnh vực mặc định',
  })
  @ApiResponse({ status: 201, description: ADMIN_ROW })
  @ApiResponse({ status: 400, description: 'Tên trống hoặc mã không hợp lệ' })
  @ApiResponse({ status: 409, description: 'Trùng mã hoặc trùng tên' })
  create(@Body() dto: CreateLearningTrackDto) {
    return this.tracks.create(dto);
  }

  @Put('order')
  @ApiOperation({
    summary:
      '[Admin] Xếp lại thứ tự mọi lĩnh vực; sortOrder thành 10, 20, 30, ...',
  })
  @ApiResponse({ status: 200, description: `Danh sách mới: [${ADMIN_ROW}]` })
  @ApiResponse({
    status: 400,
    description: 'Danh sách không chứa đúng một lần mọi mã lĩnh vực',
  })
  reorder(@Body() dto: ReorderLearningTracksDto) {
    return this.tracks.reorder(dto.codes);
  }

  @Patch(':code')
  @ApiOperation({ summary: '[Admin] Đổi tên hoặc mô tả; mã không đổi được' })
  @ApiParam({ name: 'code', example: 'IT_SOFTWARE' })
  @ApiResponse({ status: 200, description: ADMIN_ROW })
  @ApiResponse({ status: 404, description: 'Không tìm thấy lĩnh vực' })
  @ApiResponse({ status: 409, description: 'Trùng tên, hoặc đổi mã' })
  update(@Param('code') code: string, @Body() dto: UpdateLearningTrackDto) {
    return this.tracks.update(code, dto);
  }

  @Post(':code/activate')
  @HttpCode(200)
  @ApiOperation({ summary: '[Admin] Bật lại lĩnh vực' })
  @ApiParam({ name: 'code', example: 'IT_SOFTWARE' })
  @ApiResponse({ status: 200, description: ADMIN_ROW })
  @ApiResponse({ status: 404, description: 'Không tìm thấy lĩnh vực' })
  activate(@Param('code') code: string) {
    return this.tracks.setActive(code, true);
  }

  @Post(':code/deactivate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '[Admin] Tắt lĩnh vực: không chọn mới hay gắn mới được; lựa chọn và nhãn đã có vẫn giữ',
  })
  @ApiParam({ name: 'code', example: 'IT_SOFTWARE' })
  @ApiResponse({ status: 200, description: ADMIN_ROW })
  @ApiResponse({ status: 404, description: 'Không tìm thấy lĩnh vực' })
  @ApiResponse({
    status: 409,
    description: 'Lĩnh vực mặc định (GENERAL) không tắt được',
  })
  deactivate(@Param('code') code: string) {
    return this.tracks.setActive(code, false);
  }

  @Delete(':code')
  @ApiOperation({
    summary:
      '[Admin] Xoá lĩnh vực chưa được gắn cho bài nào và chưa học viên nào chọn',
  })
  @ApiParam({ name: 'code', example: 'IT_SOFTWARE' })
  @ApiResponse({ status: 200, description: '{ code, deleted: true }' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy lĩnh vực' })
  @ApiResponse({
    status: 409,
    description: 'Lĩnh vực đang được dùng, hoặc là lĩnh vực mặc định',
  })
  remove(@Param('code') code: string) {
    return this.tracks.remove(code);
  }
}
