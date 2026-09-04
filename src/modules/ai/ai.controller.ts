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
} from '@nestjs/common';
import type { Response } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from './ai.service';
import { UploadService } from '../upload/upload.service';
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

  @ApiProperty({ example: 5, description: 'Number of sentences to generate' })
  @IsNumber()
  @IsNotEmpty()
  count: number;
}

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

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
  @Post('generate-dictation')
  @ApiOperation({ summary: 'AI tự động sinh bài Luyện Nghe (Chép chính tả)' })
  async generateDictation(@Body() dto: GenerateDictationDto) {
    // 1. Gọi Gemini sinh ra JSON các câu Dictation
    const questions = await this.aiService.generateDictation(
      dto.topic,
      dto.count,
    );

    // 2. Lưu thành 1 Quiz loại LISTENING_PRACTICE
    const newQuiz = await this.prisma.quiz.create({
      data: {
        title: `Bài luyện nghe: ${dto.topic}`,
        description: 'Được tạo tự động bởi AI',
        type: 'LISTENING_PRACTICE',
      },
    });

    const questionData = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      let audioUrl = '';

      // Tạo Audio từ văn bản
      const audioBuffer = await this.aiService.generateTtsAudio(q.transcript);
      if (audioBuffer) {
        // Upload lên Cloudflare R2
        const uploadResult = await this.uploadService.uploadRawBuffer(
          audioBuffer,
          'audio/mpeg',
          'dictation_audio',
        );
        audioUrl = uploadResult.url;
      }

      questionData.push({
        quizId: newQuiz.id,
        type: 'DICTATION',
        content: {
          part: 1,
          audioUrl: audioUrl, // Đã có audio xịn
          transcript: q.transcript,
          translation: q.translation,
          words: String(q.transcript)
            .replace(/[^\w\s']/g, '')
            .split(' ')
            .filter((w: string) => w.length > 0),
        },
        order: i + 1,
      });
    }

    await this.prisma.question.createMany({
      data: questionData,
    });

    return {
      success: true,
      message: `Đã tạo ${questions.length} câu luyện nghe.`,
      quizId: newQuiz.id,
    };
  }

  @UseGuards(JwtAuthGuard, AiRateLimitGuard)
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
  @Roles(Role.ADMIN, Role.TEACHER)
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
  async importEtsPdf(
    @UploadedFiles()
    files: {
      pdfFile?: Express.Multer.File[];
      audioFile?: Express.Multer.File[];
    },
  ) {
    const pdfFile = files?.pdfFile?.[0];
    const audioFile = files?.audioFile?.[0];

    if (!pdfFile) {
      throw new BadRequestException(
        'Vui lòng upload file PDF hoặc hình ảnh đề thi (pdfFile).',
      );
    }

    let audioUrl = '';
    if (audioFile) {
      const uploadResult = await this.uploadService.uploadFile(audioFile);
      audioUrl = uploadResult.url;
    }

    const questions = await this.aiService.importEtsPdf(
      pdfFile.buffer,
      pdfFile.mimetype,
      audioFile?.buffer,
      audioFile?.mimetype,
      audioUrl,
    );

    if (!questions || questions.length === 0) {
      throw new BadRequestException(
        'AI không tìm thấy câu hỏi nào trong file này.',
      );
    }

    const newQuiz = await this.prisma.quiz.create({
      data: {
        title: `Đề thi TOEIC ETS tự động - ${new Date().toLocaleDateString('vi-VN')}`,
        description: 'Tạo tự động bởi AI Importer (PDF + Audio)',
        type: 'TOEIC',
      },
    });

    const questionData = questions.map((q, index) => ({
      quizId: newQuiz.id,
      type: q.type || 'MULTIPLE_CHOICE',
      content: q.content,
      order: index + 1,
    }));

    await this.prisma.question.createMany({
      data: questionData,
    });

    return {
      success: true,
      message: `Đã trích xuất và lưu thành công ${questions.length} câu hỏi.`,
      quizId: newQuiz.id,
    };
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
