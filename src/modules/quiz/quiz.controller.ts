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
} from '@nestjs/common';
import { QuizService } from './quiz.service';
import {
  CreateQuizDto,
  CreateQuestionDto,
  SubmitQuizDto,
} from './dto/quiz.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('quizzes')
@Controller('quizzes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Post()
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo bài trắc nghiệm (chỉ ADMIN/TEACHER)' })
  createQuiz(@Body() dto: CreateQuizDto) {
    return this.quizService.createQuiz(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật đề thi (chỉ ADMIN/TEACHER)' })
  updateQuiz(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateQuizDto>,
  ) {
    return this.quizService.updateQuiz(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa đề thi (chỉ ADMIN/TEACHER)' })
  deleteQuiz(@Param('id', ParseIntPipe) id: number) {
    return this.quizService.deleteQuiz(id);
  }

  @Get()
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy tất cả quizzes (chỉ ADMIN/TEACHER)' })
  getAllQuizzes() {
    return this.quizService.getAllQuizzes();
  }

  @Get('listening-practice')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách các bài Luyện Nghe (Nghe Chép)' })
  getListeningPractices(@Request() req: any) {
    return this.quizService.getListeningPractices(req.user.id);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy chi tiết Quiz và danh sách Questions' })
  getQuizById(@Param('id', ParseIntPipe) id: number) {
    return this.quizService.getQuizById(id);
  }

  @Post(':id/questions')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thêm câu hỏi vào Quiz' })
  createQuestion(
    @Param('id', ParseIntPipe) quizId: number,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.quizService.createQuestion(quizId, dto);
  }

  @Patch('questions/:questionId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật câu hỏi trong Quiz' })
  updateQuestion(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: Partial<CreateQuestionDto>,
  ) {
    return this.quizService.updateQuestion(questionId, dto);
  }

  @Delete('questions/:questionId')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa câu hỏi khỏi Quiz' })
  deleteQuestion(@Param('questionId', ParseIntPipe) questionId: number) {
    return this.quizService.deleteQuestion(questionId);
  }

  @Post(':id/submit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nộp bài và chấm điểm tự động (cơ bản)' })
  submitQuiz(
    @Param('id', ParseIntPipe) quizId: number,
    @Body() dto: SubmitQuizDto,
    @Request() req: any,
  ) {
    return this.quizService.submitQuiz(quizId, req.user.id, dto);
  }

  @Get('submissions/:id/analytics')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Báo cáo phân tích điểm mạnh, điểm yếu và lỗ hổng kiến thức sau khi nộp bài',
  })
  getSubmissionAnalytics(@Param('id', ParseIntPipe) id: number) {
    return this.quizService.getSubmissionAnalytics(id);
  }

  @Post('score-conversion')
  @ApiBearerAuth()
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
