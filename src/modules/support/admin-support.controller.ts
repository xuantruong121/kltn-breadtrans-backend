import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { SupportService } from './support.service';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { SupportQueryDto } from './dto/support-query.dto';
import { ToggleSupportModeDto } from './dto/toggle-support-mode.dto';

@ApiTags('admin-support')
@Controller('admin/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('conversations')
  @ApiOperation({
    summary: 'Admin lấy danh sách tất cả các cuộc hội thoại hỗ trợ',
  })
  getAllConversations(@Query() query: SupportQueryDto) {
    return this.supportService.getAdminConversations(query);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Admin lấy chi tiết một cuộc hội thoại' })
  getConversation(@Param('id', ParseIntPipe) id: number) {
    return this.supportService.getAdminConversation(id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary: 'Admin lấy danh sách tin nhắn của một cuộc hội thoại',
  })
  getMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SupportQueryDto,
  ) {
    return this.supportService.getAdminMessages(id, query);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Admin trả lời tin nhắn hỗ trợ học viên' })
  sendMessage(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSupportMessageDto,
  ) {
    return this.supportService.sendAdminMessage(req.user.id, id, dto);
  }

  @Patch('conversations/:id/mode')
  @ApiOperation({ summary: 'Admin chuyển đổi chế độ AI / HUMAN của hội thoại' })
  toggleMode(
    @Request() req: { user: { id: number; role: string } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleSupportModeDto,
  ) {
    return this.supportService.updateConversationMode(id, dto.mode, req.user);
  }
}
