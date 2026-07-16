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
}
