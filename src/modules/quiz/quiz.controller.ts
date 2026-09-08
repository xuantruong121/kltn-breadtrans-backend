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
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo bài trắc nghiệm (Admin)' })
  createQuiz(@Body() dto: CreateQuizDto, @Request() req: any) {
    return this.quizService.createQuiz(dto, req.user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật đề thi (Admin)' })
  updateQuiz(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateQuizDto>,
    @Request() req: any,
  ) {
    return this.quizService.updateQuiz(id, dto, req.user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa đề thi (Admin)' })
  deleteQuiz(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.quizService.deleteQuiz(id, req.user);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy tất cả quizzes (Admin)' })
  getAllQuizzes() {
    return this.quizService.getAllQuizzes();
  }

  @Get('listening-practice')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách các bài Luyện Nghe (Nghe Chép)' })
  getListeningPractices(@Request() req: any) {
    return this.quizService.getListeningPractices(req.user.id);
  }

  @Get('toeic-papers')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách đề TOEIC 2 và 4 kỹ năng' })
  getToeicPapers(@Request() req: any) {
    return this.quizService.getToeicPapers(req.user.id);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy chi tiết Quiz và danh sách Questions' })
  getQuizById(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    const isStaff = req.user?.role === Role.ADMIN;
    return this.quizService.getQuizById(id, isStaff);
  }

  @Post(':id/questions')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thêm câu hỏi vào Quiz (Admin)' })
  createQuestion(
    @Param('id', ParseIntPipe) quizId: number,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.quizService.createQuestion(quizId, dto);
  }

  @Patch('questions/:questionId')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật câu hỏi trong Quiz (Admin)' })
  updateQuestion(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: Partial<CreateQuestionDto>,
  ) {
    return this.quizService.updateQuestion(questionId, dto);
  }

  @Delete('questions/:questionId')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa câu hỏi khỏi Quiz (Admin)' })
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
