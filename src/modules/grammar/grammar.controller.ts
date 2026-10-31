import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { GrammarService } from './grammar.service';
import {
  CreateGrammarTopicDto,
  UpdateGrammarTopicDto,
  CreateGrammarQuestionDto,
  UpdateGrammarQuestionDto,
  SubmitGrammarAttemptDto,
  ReorderGrammarQuestionsDto,
  CreateGrammarQuestionsDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('Grammar')
@Controller('grammar')
export class GrammarController {
  constructor(private readonly grammarService: GrammarService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get('topics')
  @ApiOperation({ summary: 'Lấy danh sách các chủ đề ngữ pháp kèm tiến độ' })
  getTopics(@Request() req: any) {
    const userId = req?.user?.id;
    const isStaff = req?.user?.role === Role.ADMIN;
    return this.grammarService.getTopics(userId, isStaff);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('topics/:id')
  @ApiOperation({
    summary: 'Lấy chi tiết một chủ đề ngữ pháp và danh sách câu hỏi',
  })
  getTopicDetail(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    const userId = req?.user?.id;
    const isStaff = req?.user?.role === Role.ADMIN;
    return this.grammarService.getTopicDetail(id, userId, isStaff);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('topics/:id/attempt')
  @ApiOperation({
    summary: 'Nộp bài làm trắc nghiệm ngữ pháp và nhận thưởng Bánh Mì',
  })
  submitAttempt(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitGrammarAttemptDto,
    @Request() req: any,
  ) {
    return this.grammarService.submitAttempt(id, req.user.id, dto.answers);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-attempts')
  @ApiOperation({ summary: 'Lấy lịch sử làm bài ngữ pháp của học viên' })
  getMyAttempts(@Request() req: any) {
    return this.grammarService.getMyAttempts(req.user.id);
  }

  // Admin APIs (Phase 4 CMS)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('topics')
  @ApiOperation({ summary: '[Admin] Tạo chủ đề ngữ pháp mới (DRAFT)' })
  createTopic(@Body() dto: CreateGrammarTopicDto) {
    return this.grammarService.createTopic(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch('topics/:id')
  @ApiOperation({ summary: '[Admin] Cập nhật chủ đề ngữ pháp' })
  updateTopic(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGrammarTopicDto,
  ) {
    return this.grammarService.updateTopic(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('topics/:id/publish')
  @ApiOperation({ summary: '[Admin] Kiểm tra hợp lệ và xuất bản chủ đề' })
  publishTopic(@Param('id', ParseIntPipe) id: number) {
    return this.grammarService.publishTopic(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('topics/:id/unpublish')
  @ApiOperation({ summary: '[Admin] Gỡ xuất bản chủ đề (về DRAFT)' })
  unpublishTopic(@Param('id', ParseIntPipe) id: number) {
    return this.grammarService.unpublishTopic(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete('topics/:id')
  @ApiOperation({
    summary: '[Admin] Xóa chủ đề ngữ pháp (bảo vệ lịch sử học tập)',
  })
  deleteTopic(@Param('id', ParseIntPipe) id: number) {
    return this.grammarService.deleteTopic(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('topics/:id/questions')
  @ApiOperation({ summary: '[Admin] Thêm câu hỏi cho chủ đề ngữ pháp' })
  createQuestion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGrammarQuestionDto,
  ) {
    return this.grammarService.createQuestion(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('topics/:id/questions/bulk')
  @ApiOperation({
    summary:
      '[Admin] Thêm nhiều câu hỏi một lần (tất cả hoặc không câu nào), nối sau câu cuối',
  })
  @ApiResponse({
    status: 400,
    description: 'Có câu không hợp lệ; errors liệt kê từng câu',
  })
  createQuestions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGrammarQuestionsDto,
  ) {
    return this.grammarService.createQuestions(id, dto.questions);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch('topics/:topicId/questions/:questionId')
  @ApiOperation({ summary: '[Admin] Cập nhật câu hỏi ngữ pháp' })
  updateQuestion(
    @Param('topicId', ParseIntPipe) topicId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: UpdateGrammarQuestionDto,
  ) {
    return this.grammarService.updateQuestion(topicId, questionId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete('topics/:topicId/questions/:questionId')
  @ApiOperation({
    summary: '[Admin] Xóa câu hỏi ngữ pháp (kiểm tra ownership & history)',
  })
  deleteTopicQuestion(
    @Param('topicId', ParseIntPipe) topicId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ) {
    return this.grammarService.deleteQuestion(topicId, questionId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('topics/:id/reorder-questions')
  @ApiOperation({ summary: '[Admin] Sắp xếp lại thứ tự câu hỏi trong chủ đề' })
  reorderQuestions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderGrammarQuestionsDto,
  ) {
    return this.grammarService.reorderQuestions(id, dto.questionIds);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete('questions/:id')
  @ApiOperation({ summary: '[Admin] Xóa câu hỏi ngữ pháp (legacy shortcut)' })
  deleteQuestion(@Param('id', ParseIntPipe) id: number) {
    return this.grammarService.deleteQuestionById(id);
  }
}
