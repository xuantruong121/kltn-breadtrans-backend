import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { QuizService } from './quiz.service';
import {
  CreateQuizDto,
  CreateQuestionDto,
  SubmitQuizDto,
  CheckPracticeQuestionDto,
} from './dto/quiz.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('quizzes')
@Controller('quizzes')
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Tạo bài trắc nghiệm (Admin)' })
  createQuiz(@Body() dto: CreateQuizDto, @Request() req: any) {
    return this.quizService.createQuiz(dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật đề thi (Admin)' })
  updateQuiz(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateQuizDto>,
    @Request() req: any,
  ) {
    return this.quizService.updateQuiz(id, dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Xóa đề thi (Admin)' })
  deleteQuiz(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.quizService.deleteQuiz(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lấy tất cả quizzes (Admin)' })
  getAllQuizzes() {
    return this.quizService.getAllQuizzes();
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('listening-practice')
  @ApiOperation({ summary: 'Lấy danh sách các bài Luyện Nghe (Nghe Chép)' })
  getListeningPractices(@Request() req: any) {
    return this.quizService.getListeningPractices(req.user?.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('toeic-papers')
  @ApiOperation({ summary: 'Lấy danh sách đề TOEIC 2 và 4 kỹ năng' })
  getToeicPapers(@Request() req: any) {
    return this.quizService.getToeicPapers(req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':quizId/questions/:questionId/audio')
  @ApiOperation({ summary: 'Phát audio cho một câu luyện nghe' })
  async streamQuestionAudio(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Res() res: Response,
  ) {
    const audioBuffer = await this.quizService.streamQuestionAudio(
      quizId,
      questionId,
    );
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'private, max-age=86400',
      Vary: 'Authorization',
    });
    res.send(audioBuffer);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':quizId/questions/:questionId/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kiểm tra đáp án tức thời cho bài luyện nghe' })
  checkPracticeQuestion(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: CheckPracticeQuestionDto,
  ) {
    return this.quizService.checkPracticeQuestion(quizId, questionId, dto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết Quiz và danh sách Questions' })
  getQuizById(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    const isStaff = req.user?.role === Role.ADMIN;
    return this.quizService.getQuizById(id, isStaff, req.user?.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':id/questions')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Thêm câu hỏi vào Quiz (Admin)' })
  createQuestion(
    @Param('id', ParseIntPipe) quizId: number,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.quizService.createQuestion(quizId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch('questions/:questionId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật câu hỏi trong Quiz (Admin)' })
  updateQuestion(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: Partial<CreateQuestionDto>,
  ) {
    return this.quizService.updateQuestion(questionId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete('questions/:questionId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Xóa câu hỏi khỏi Quiz (Admin)' })
  deleteQuestion(@Param('questionId', ParseIntPipe) questionId: number) {
    return this.quizService.deleteQuestion(questionId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':id/submit')
  @ApiOperation({ summary: 'Nộp bài và chấm điểm tự động (cơ bản)' })
  submitQuiz(
    @Param('id', ParseIntPipe) quizId: number,
    @Body() dto: SubmitQuizDto,
    @Request() req: any,
  ) {
    return this.quizService.submitQuiz(quizId, req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('submissions/:id/analytics')
  @ApiOperation({
    summary:
      'Báo cáo phân tích điểm mạnh, điểm yếu và lỗ hổng kiến thức sau khi nộp bài',
  })
  getSubmissionAnalytics(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.quizService.getSubmissionAnalytics(
      id,
      req.user.id,
      req.user.role,
    );
  }

  @Post('score-conversion')
  @ApiOperation({
    summary:
      'Quy đổi số câu đúng Listening/Reading ra thang điểm TOEIC (10 - 990)',
  })
  calculateToeicScore(
    @Body('listeningCorrect') listeningCorrect: number,
    @Body('readingCorrect') readingCorrect: number,
  ) {
    return this.quizService.calculateToeicScore(
      listeningCorrect,
      readingCorrect,
    );
  }
}
