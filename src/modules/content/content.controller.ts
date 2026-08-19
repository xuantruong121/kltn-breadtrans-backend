import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ContentService } from './content.service';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Content Topics (Movies/Music/Learn)')
@Controller('content-topics')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách chủ đề học qua phim/nhạc (Learn Media)',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['movie', 'music', 'grammar'],
  })
  getContentTopics(@Query('category') category?: string) {
    return this.contentService.getContentTopics(category);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết chủ đề học kèm bài tập' })
  getContentTopicById(@Param('id') id: string) {
    return this.contentService.getContentTopicById(id);
  }

  // Admin APIs
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: '[Admin] Tạo chủ đề học qua phim/nhạc mới' })
  createContentTopic(@Body() dto: any) {
    return this.contentService.createContentTopic(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: '[Admin] Xóa chủ đề học qua phim/nhạc' })
  deleteContentTopic(@Param('id', ParseIntPipe) id: number) {
    return this.contentService.deleteContentTopic(id);
  }
}
