import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { GrammarService } from './grammar.service';
import { CreateGrammarTopicDto } from './dto/create-grammar-topic.dto';
import { CreateGrammarQuestionDto } from './dto/create-grammar-question.dto';
import { SubmitGrammarAttemptDto } from './dto/submit-grammar-attempt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Grammar')
@Controller('grammar')
export class GrammarController {
  constructor(private readonly grammarService: GrammarService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('topics')
  @ApiOperation({ summary: 'Lấy danh sách các chủ đề ngữ pháp kèm tiến độ' })
  getTopics(@Request() req: any) {
    const userId = req?.user?.id;
    return this.grammarService.getTopics(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('topics/:id')
  @ApiOperation({
    summary: 'Lấy chi tiết một chủ đề ngữ pháp và danh sách câu hỏi',
  })
  getTopicDetail(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    const userId = req?.user?.id;
    return this.grammarService.getTopicDetail(id, userId);
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

  // Admin / Teacher APIs
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @Post('topics')
  @ApiOperation({ summary: '[Admin/Teacher] Tạo chủ đề ngữ pháp mới' })
  createTopic(@Body() dto: CreateGrammarTopicDto) {
    return this.grammarService.createTopic(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @Post('topics/:id/questions')
  @ApiOperation({ summary: '[Admin/Teacher] Thêm câu hỏi cho chủ đề ngữ pháp' })
  createQuestion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGrammarQuestionDto,
  ) {
    return this.grammarService.createQuestion(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete('topics/:id')
  @ApiOperation({ summary: '[Admin] Xóa chủ đề ngữ pháp' })
  deleteTopic(@Param('id', ParseIntPipe) id: number) {
    return this.grammarService.deleteTopic(id);
  }
}
