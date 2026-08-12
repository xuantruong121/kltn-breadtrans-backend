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
  @ApiOperation({ summary: 'Nộp bài và chấm điểm bằng AI (Part 1)' })
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

  @Post('part2/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Chấm điểm bài TOEIC Writing Part 2 (Respond to an Email)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        emailPrompt: { type: 'string', description: 'Nội dung email đề bài' },
        userResponse: {
          type: 'string',
          description: 'Email trả lời của học viên',
        },
      },
    },
  })
  submitWritingPart2(
    @Request() req: any,
    @Body('emailPrompt') emailPrompt: string,
    @Body('userResponse') userResponse: string,
  ) {
    return this.writingService.submitWritingPart2(
      emailPrompt,
      req.user.id,
      userResponse,
    );
  }

  @Post('part3/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Chấm điểm bài TOEIC Writing Part 3 (Write an Opinion Essay)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        essayTopic: { type: 'string', description: 'Chủ đề bài luận đề bài' },
        userEssay: { type: 'string', description: 'Bài luận của học viên' },
      },
    },
  })
  submitWritingPart3(
    @Request() req: any,
    @Body('essayTopic') essayTopic: string,
    @Body('userEssay') userEssay: string,
  ) {
    return this.writingService.submitWritingPart3(
      essayTopic,
      req.user.id,
      userEssay,
    );
  }
}
