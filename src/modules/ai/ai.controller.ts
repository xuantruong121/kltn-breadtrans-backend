import {
  Controller,
  Post,
  Get,
  Query,
  Res,
  Body,
  Request,
  UseGuards,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AiService } from './ai.service';
import { TutorService } from './tutor.service';
import type { TutorTurn } from './tutor-prompt.logic';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiProperty,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiRateLimitGuard } from '../../common/guards/ai-rate-limit.guard';
import { IsString, IsOptional, IsArray } from 'class-validator';

export class ChatDto {
  @ApiProperty({
    example:
      'Can you explain the difference between present perfect and past simple?',
    required: false,
  })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiProperty({
    required: false,
    type: 'array',
    items: { type: 'object' },
  })
  @IsOptional()
  @IsArray()
  messages?: Array<{ role: string; content: string }>;
}

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly tutor: TutorService,
  ) {}

  // The tutor has its own daily limit by plan (TutorService), so this route
  // does not also count against the shared AI grading quota.
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('chat')
  @ApiOperation({
    summary:
      'Hỏi trợ lý học tập; messages là hội thoại gần đây, tin cuối của người học là câu hỏi',
  })
  async chat(
    @Request() req: { user: { id: number } },
    @Body() chatDto: ChatDto,
  ) {
    const turns: TutorTurn[] = (chatDto.messages ?? [])
      .filter((m) => typeof m?.content === 'string' && m.content.trim())
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
    let message = chatDto.prompt?.trim();
    let history = turns;
    if (!message) {
      const last = turns.map((t) => t.role).lastIndexOf('user');
      if (last >= 0) {
        message = turns[last].content.trim();
        history = turns.slice(0, last);
      }
    }

    if (!message) {
      throw new BadRequestException(
        'Vui lòng cung cấp nội dung câu hỏi (prompt hoặc messages)',
      );
    }

    const { reply, quota, limited } = await this.tutor.reply(req.user.id, {
      message,
      history,
    });
    return { reply, answer: reply, quota, limited };
  }

  @UseGuards(JwtAuthGuard, AiRateLimitGuard)
  @ApiBearerAuth()
  @Post('explain-toeic-error/:questionId')
  @ApiOperation({
    summary: 'AI Gia sư giải thích tại sao câu TOEIC này bị sai',
  })
  async explainToeicError(
    @Body()
    body: {
      questionContent: any;
      userAnswer: string;
      correctAnswer: string;
    },
  ) {
    const explanation = await this.aiService.explainToeicError(
      body.questionContent,
      body.userAnswer,
      body.correctAnswer,
    );
    return { success: true, explanation };
  }

  @Get('tts/vietnamese')
  @ApiOperation({
    summary: 'Tạo giọng đọc tiếng Việt chuẩn bằng Azure Neural TTS',
  })
  async getVietnameseTts(@Query('text') text: string, @Res() res: Response) {
    if (!text) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: 'Vui lòng nhập nội dung.' });
    }

    const cleanText = text
      .replace(
        /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FAFF}]|[\u{1F000}-\u{1F02F}]/gu,
        '',
      )
      .replace(/\u200D|\uFE0E|\uFE0F/g, '')
      .trim();

    const audioBuffer =
      await this.aiService.generateVietnameseTtsAudio(cleanText);

    if (!audioBuffer) {
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ message: 'Không tạo được giọng đọc tiếng Việt.' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(audioBuffer);
  }
}
