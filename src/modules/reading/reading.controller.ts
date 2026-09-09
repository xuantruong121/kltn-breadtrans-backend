import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ReadingService } from './reading.service';
import { TopicCategory } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@ApiTags('reading')
@Controller('reading')
export class ReadingController {
  constructor(private readonly readingService: ReadingService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get('topics')
  @ApiOperation({ summary: 'Lấy danh sách các chủ đề (kèm tiến độ học tập)' })
  @ApiQuery({ name: 'category', enum: TopicCategory })
  getTopicsByCategory(
    @Query('category') category: TopicCategory,
    @Request() req: any,
  ) {
    return this.readingService.getTopicsByCategory(category, req.user?.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('topics/:id')
  @ApiOperation({
    summary: 'Lấy chi tiết một chủ đề (gồm các bài Quizzes con)',
  })
  getTopicDetails(@Param('id', ParseIntPipe) id: number) {
    return this.readingService.getTopicDetails(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('quizzes/:id/theory')
  @ApiOperation({ summary: 'Lấy nội dung bài học lý thuyết của Quiz' })
  getQuizTheory(@Param('id', ParseIntPipe) id: number) {
    return this.readingService.getQuizTheory(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('bilingual-progress')
  @ApiOperation({ summary: 'Lấy thống kê Tiến độ phần Đọc Song Ngữ' })
  getBilingualProgress(@Request() req: any) {
    return this.readingService.getBilingualProgress(req.user.id);
  }
}
