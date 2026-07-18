import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiProperty,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsString, IsNotEmpty } from 'class-validator';

export class ChatDto {
  @ApiProperty({
    example:
      'Can you explain the difference between present perfect and past simple?',
  })
  @IsString()
  @IsNotEmpty()
  prompt: string;
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

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('chat')
  @ApiOperation({ summary: 'Chat với trợ lý AI ảo (Hỗ trợ học tập)' })
  async chat(@Body() chatDto: ChatDto) {
    const reply = await this.aiService.chat(chatDto.prompt);
    return { reply };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('generate-toeic-quiz')
  @ApiOperation({ summary: 'Sinh bộ câu hỏi TOEIC tự động theo chủ đề' })
  async generateToeicQuiz(@Body() dto: GenerateToeicDto) {
    // Gọi AI sinh câu hỏi (JSON)
    const questions = await this.aiService.generateToeicQuestions(dto.topic, dto.part, dto.count);
    // (Trong thực tế, QuizController sẽ lấy questions này lưu vào DB. Ở đây trả về trực tiếp để review)
    return { success: true, questions };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('explain-toeic-error/:questionId')
  @ApiOperation({ summary: 'AI Gia sư giải thích tại sao câu TOEIC này bị sai' })
  async explainToeicError(
    @Body() body: { questionContent: any; userAnswer: string; correctAnswer: string },
  ) {
    const explanation = await this.aiService.explainToeicError(
      body.questionContent,
      body.userAnswer,
      body.correctAnswer,
    );
    return { success: true, explanation };
  }
}
