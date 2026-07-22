import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
  Body,
} from '@nestjs/common';
import { VocabService } from './vocab.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Vocab')
@Controller('vocab')
export class VocabController {
  constructor(private readonly vocabService: VocabService) {}

  @Get('topics')
  @ApiOperation({ summary: 'Lấy danh sách các chủ đề từ vựng TOEIC' })
  getTopics(@Request() req: any) {
    const userId = req?.user?.userId;
    return this.vocabService.getTopics(userId);
  }

  @Get('topics/:id')
  @ApiOperation({ summary: 'Lấy chi tiết 1 chủ đề từ vựng và danh sách từ' })
  getTopicDetails(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    const userId = req?.user?.userId;
    return this.vocabService.getTopicDetails(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('words/:id/star')
  @ApiOperation({ summary: 'Đánh dấu Yêu thích / Bỏ yêu thích từ vựng' })
  toggleStar(
    @Param('id', ParseIntPipe) wordId: number,
    @Request() req: any,
  ) {
    return this.vocabService.toggleStar(req.user.userId, wordId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('words/:id/master')
  @ApiOperation({ summary: 'Đánh dấu Đã thuộc / Bỏ thuộc từ vựng' })
  toggleMastered(
    @Param('id', ParseIntPipe) wordId: number,
    @Request() req: any,
  ) {
    return this.vocabService.toggleMastered(req.user.userId, wordId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('words/:id/review')
  @ApiOperation({ summary: 'Cập nhật tiến độ ôn tập SRS sau khi học/làm trắc nghiệm' })
  submitReview(
    @Param('id', ParseIntPipe) wordId: number,
    @Body('isCorrect') isCorrect: boolean,
    @Request() req: any,
  ) {
    return this.vocabService.submitReview(req.user.userId, wordId, isCorrect);
  }
}
