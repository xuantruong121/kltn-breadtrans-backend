import {
  Controller,
  Post,
  Get,
  Query,
  Res,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  HttpStatus,
  GoneException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AiService } from './ai.service';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiProperty,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AiRateLimitGuard } from '../../common/guards/ai-rate-limit.guard';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  Min,
} from 'class-validator';

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

export class GenerateToeicDto {
  @ApiProperty({ example: 'Office Equipment' })
  @IsString()
  @IsNotEmpty()
  topic: string;

  @ApiProperty({ example: 5 })
  part: number;

  @ApiProperty({ example: 5 })
  count: number;
}

export class GenerateDictationDto {
  @ApiProperty({ example: 'Daily conversation at the restaurant' })
  @IsString()
  @IsNotEmpty()
  topic: string;

  @ApiProperty({
    example: 20,
    minimum: 20,
    description: 'Minimum 20 sentences per dictation exercise',
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(20)
  count: number;
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

  @UseGuards(JwtAuthGuard, RolesGuard, AiRateLimitGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('generate-dictation')
  @ApiOperation({ summary: 'AI tự động sinh bài Luyện Nghe (Chép chính tả)' })
  generateDictation(@Body() dto: GenerateDictationDto) {
    void dto;
    throw new GoneException(
      'Đường dẫn legacy đã được đóng để bảo vệ quy trình AI soạn bài. Hãy dùng Admin AI Generator để tạo bản nháp, xem duyệt và xuất bản.',
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard, AiRateLimitGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('generate-toeic-quiz')
  @ApiOperation({ summary: 'Sinh bộ câu hỏi TOEIC tự động theo chủ đề' })
  async generateToeicQuiz(@Body() dto: GenerateToeicDto) {
    const questions = await this.aiService.generateToeicQuestions(
      dto.topic,
      dto.part,
      dto.count,
    );
    return { success: true, questions };
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

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('import-ets-pdf')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'pdfFile', maxCount: 1 },
      { name: 'audioFile', maxCount: 1 },
    ]),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'AI tự động đọc PDF + Audio đề ETS và trích xuất vào DB (Chỉ ADMIN/TEACHER)',
  })
  importEtsPdf(
    @UploadedFiles()
    files: {
      pdfFile?: Express.Multer.File[];
      audioFile?: Express.Multer.File[];
    },
  ) {
    throw new GoneException(
      'Đường dẫn import legacy đã được đóng. Hãy dùng Admin AI Generator có job bền vững và bước xem duyệt.',
    );
    void files;
  }

  @Get('tts/vietnamese')
  @ApiOperation({
    summary: 'Tạo giọng đọc tiếng Việt chuẩn bằng Azure Neural TTS',
  })
  async getVietnameseTts(@Query('text') text: string, @Res() res: Response) {
    if (!text) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: 'Text is required' });
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
        .json({ message: 'Failed to generate Vietnamese TTS' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(audioBuffer);
  }
}
