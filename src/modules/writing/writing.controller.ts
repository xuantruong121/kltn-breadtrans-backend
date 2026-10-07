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
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AiRateLimitGuard } from '../../common/guards/ai-rate-limit.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

class SubmitWritingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  answer!: string;

  @IsOptional()
  @IsUUID()
  clientAttemptId?: string;
}

class SubmitWritingPart2Dto {
  @IsInt()
  quizId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  userResponse!: string;

  @IsOptional()
  @IsUUID()
  clientAttemptId?: string;
}

class SubmitWritingPart3Dto {
  @IsInt()
  quizId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  userEssay!: string;

  @IsOptional()
  @IsUUID()
  clientAttemptId?: string;
}

@ApiTags('Writing')
@Controller('writing')
export class WritingController {
  constructor(private readonly writingService: WritingService) {}

  @Get('topics')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Lấy danh sách các chủ điểm và bài viết Writing Part 1',
  })
  getTopics(@Request() req: any) {
    return this.writingService.getTopics(req?.user?.id, req?.user?.role);
  }

  @Get('quizzes/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Lấy chi tiết 1 bài tập Writing Part 1' })
  getQuizDetails(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.writingService.getQuizDetails(
      id,
      req?.user?.id,
      req?.user?.role,
    );
  }

  @Get('quizzes/:id/community')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Lấy bài nộp của cộng đồng cho 1 bài tập' })
  getCommunitySubmissions(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.writingService.getCommunitySubmissions(
      id,
      req?.user?.id,
      req?.user?.role,
    );
  }

  @Post('quizzes/:id/submit')
  @UseGuards(JwtAuthGuard, AiRateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nộp bài và chấm điểm bằng AI (Part 1)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        clientAttemptId: { type: 'string', format: 'uuid' },
      },
    },
  })
  submitWriting(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
    @Body() body: SubmitWritingDto,
  ) {
    return this.writingService.submitWriting(
      id,
      req.user.id,
      body.answer,
      req.user.role,
      body.clientAttemptId,
    );
  }

  @Post('part2/submit')
  @UseGuards(JwtAuthGuard, AiRateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Chấm điểm bài TOEIC Writing Part 2 (Respond to an Email)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        quizId: {
          type: 'integer',
          description: 'ID bài Writing chuẩn trên server',
        },
        userResponse: {
          type: 'string',
          description: 'Email trả lời của học viên',
        },
      },
    },
  })
  submitWritingPart2(@Request() req: any, @Body() body: SubmitWritingPart2Dto) {
    return this.writingService.submitWritingPart2(
      body.quizId,
      req.user.id,
      body.userResponse,
      req.user.role,
      body.clientAttemptId,
    );
  }

  @Post('part3/submit')
  @UseGuards(JwtAuthGuard, AiRateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Chấm điểm bài TOEIC Writing Part 3 (Write an Opinion Essay)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        quizId: {
          type: 'integer',
          description: 'ID bài Writing chuẩn trên server',
        },
        userEssay: { type: 'string', description: 'Bài luận của học viên' },
      },
    },
  })
  submitWritingPart3(@Request() req: any, @Body() body: SubmitWritingPart3Dto) {
    return this.writingService.submitWritingPart3(
      body.quizId,
      req.user.id,
      body.userEssay,
      req.user.role,
      body.clientAttemptId,
    );
  }
}
