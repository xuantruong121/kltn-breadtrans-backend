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
  ForbiddenException,
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

@ApiTags('support')
@Controller('support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT)
@ApiBearerAuth()
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('conversations/me')
  @ApiOperation({ summary: 'Lấy hoặc tạo cuộc hội thoại hỗ trợ của học viên' })
  getMyConversation(@Request() req: { user: { id: number } }) {
    return this.supportService.getOrCreateStudentConversation(req.user.id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Lấy danh sách tin nhắn phân trang của học viên' })
  getMessages(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SupportQueryDto,
  ) {
    return this.supportService.getStudentMessages(req.user.id, id, query);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Học viên gửi tin nhắn hỗ trợ' })
  sendMessage(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSupportMessageDto,
  ) {
    return this.supportService.sendStudentMessage(req.user.id, id, dto);
  }

  @Post('conversations/:id/ai-messages')
  @ApiOperation({ summary: 'Học viên lưu phản hồi của AI vào cuộc trò chuyện' })
  async saveAiMessage(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSupportMessageDto,
  ) {
    const conv = await this.supportService.getOrCreateStudentConversation(
      req.user.id,
    );
    if (conv.id !== id) {
      throw new ForbiddenException(
        'You do not have permission to post to this conversation',
      );
    }
    return this.supportService.createAiMessage(
      id,
      dto.content,
      dto.clientMessageId,
    );
  }

  @Patch('conversations/:id/mode')
  @ApiOperation({ summary: 'Học viên chuyển đổi chế độ AI / HUMAN' })
  toggleMode(
    @Request() req: { user: { id: number; role: string } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleSupportModeDto,
  ) {
    return this.supportService.updateConversationMode(id, dto.mode, req.user);
  }
}
