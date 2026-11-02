import {
  Controller,
  Post,
  Get,
  Query,
  Res,
  Body,
  UseGuards,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AiService } from './ai.service';
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
  constructor(private readonly aiService: AiService) {}

  @UseGuards(JwtAuthGuard, AiRateLimitGuard)
  @ApiBearerAuth()
  @Post('chat')
  @ApiOperation({ summary: 'Chat với trợ lý AI ảo (Hỗ trợ học tập)' })
  async chat(@Body() chatDto: ChatDto) {
    let textPrompt = chatDto.prompt;
    if (!textPrompt && chatDto.messages && chatDto.messages.length > 0) {
      const lastUserMsg = [...chatDto.messages]
        .reverse()
        .find((m) => m.role === 'user');
      textPrompt = lastUserMsg
        ? lastUserMsg.content
        : chatDto.messages[chatDto.messages.length - 1].content;
    }

    if (!textPrompt) {
      throw new BadRequestException(
        'Vui lòng cung cấp nội dung câu hỏi (prompt hoặc messages)',
      );
    }

    const reply = await this.aiService.chat(textPrompt);
    return { reply, answer: reply };
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
