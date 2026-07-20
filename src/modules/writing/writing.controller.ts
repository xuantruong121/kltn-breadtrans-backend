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
import { WritingService } from './writing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Writing')
@Controller('writing')
export class WritingController {
  constructor(private readonly writingService: WritingService) {}

  @Get('topics')
  @ApiOperation({
    summary: 'Lấy danh sách các chủ điểm và bài viết Writing Part 1',
  })
  getTopics() {
    return this.writingService.getTopics();
  }

  @Get('quizzes/:id')
  @ApiOperation({ summary: 'Lấy chi tiết 1 bài tập Writing Part 1' })
  getQuizDetails(@Param('id', ParseIntPipe) id: number) {
    return this.writingService.getQuizDetails(id);
  }

  @Get('quizzes/:id/community')
  @ApiOperation({ summary: 'Lấy bài nộp của cộng đồng cho 1 bài tập' })
  getCommunitySubmissions(@Param('id', ParseIntPipe) id: number) {
    return this.writingService.getCommunitySubmissions(id);
  }

  @Post('quizzes/:id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nộp bài và chấm điểm bằng AI' })
  @ApiBody({
    schema: { type: 'object', properties: { answer: { type: 'string' } } },
  })
  submitWriting(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
    @Body('answer') answer: string,
  ) {
    return this.writingService.submitWriting(id, req.user.id, answer);
  }
}
