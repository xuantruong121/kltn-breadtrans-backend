import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  Request,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiQuery,
  ApiBody,
  ApiHeader,
  ApiResponse,
} from '@nestjs/swagger';
import { SpeakingService } from './speaking.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { TtsRequestDto } from './dto/tts-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AiRateLimitGuard } from '../../common/guards/ai-rate-limit.guard';

@ApiTags('Speaking Practice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('speaking')
export class SpeakingController {
  constructor(private readonly speakingService: SpeakingService) {}

  // ── ADMIN / TEACHER: Quản lý bài tập ──────────────────────────────────────

  @Post('exercises')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: '[Admin/Teacher] Tạo bài tập phát âm mới' })
  createExercise(@Body() dto: CreateExerciseDto) {
    return this.speakingService.createExercise(dto);
  }

  // ── STUDENT: Xem & Làm bài ────────────────────────────────────────────────

  @Get('exercises')
  @ApiOperation({ summary: 'Lấy danh sách bài tập phát âm' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['IELTS', 'TOEIC', 'GENERAL'],
  })
  findAllExercises(@Query('category') category: string, @Request() req: any) {
    return this.speakingService.findAllExercises(category, req?.user?.id);
  }

  @Get('exercises/:id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết một bài tập' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.speakingService.findExerciseById(id);
  }

  @UseGuards(JwtAuthGuard, AiRateLimitGuard)
  @Post('exercises/:id/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Nộp audio để AI chấm phát âm (Bất đồng bộ - Durable Queue)',
    description:
      'Upload file audio WAV mono 16kHz. Yêu cầu header Idempotency-Key. Trả về HTTP 202 Accepted ngay lập tức cùng pollUrl.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Khóa chống trùng lặp duy nhất cho mỗi lần bấm nộp bài',
    required: true,
  })
  @ApiResponse({
    status: 202,
    description: 'Yêu cầu chấm điểm đã được tiếp nhận thành công',
    schema: {
      type: 'object',
      properties: {
        submissionId: { type: 'number', example: 123 },
        status: { type: 'string', example: 'PENDING' },
        pollUrl: { type: 'string', example: '/speaking/submissions/123' },
        acceptedAt: { type: 'string', example: '2026-09-09T00:00:00.000Z' },
      },
    },
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File audio giọng đọc (16kHz mono PCM WAV)',
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description: 'File audio (.wav) - tối đa 10MB',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('audio'))
  submitAudio(
    @Param('id', ParseIntPipe) exerciseId: number,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
      }),
    )
    audio: Express.Multer.File,
  ) {
    return this.speakingService.submitAudio(
      exerciseId,
      req.user.id,
      audio,
      idempotencyKey,
    );
  }

  @Get('submissions/:submissionId')
  @ApiOperation({
    summary: 'Tra cứu trạng thái và kết quả bài nộp phát âm',
    description:
      'Chỉ chủ sở hữu bài nộp hoặc Admin mới có quyền truy cập. Trả về thông tin trạng thái, điểm số và audio an toàn.',
  })
  getSubmission(
    @Param('submissionId', ParseIntPipe) submissionId: number,
    @Request() req: any,
  ) {
    return this.speakingService.getSubmission(submissionId, req.user);
  }

  @Get('submissions/:submissionId/audio')
  @ApiOperation({
    summary: 'Lấy đường dẫn URL audio có chữ ký bảo mật ngắn hạn',
  })
  getSubmissionAudio(
    @Param('submissionId', ParseIntPipe) submissionId: number,
    @Request() req: any,
  ) {
    return this.speakingService.getAudioSignedUrl(submissionId, req.user);
  }

  @Get('my-submissions')
  @ApiOperation({ summary: 'Xem lịch sử bài luyện phát âm của tôi' })
  getMySubmissions(@Request() req: any) {
    return this.speakingService.getMySubmissions(req.user.id);
  }

  @Post('tts')
  @UseGuards(AiRateLimitGuard)
  @ApiOperation({
    summary: 'Tạo giọng đọc mẫu chuẩn Neural TTS (US/UK)',
    description:
      'Hỗ trợ chỉnh giọng Mỹ/Anh và tốc độ đọc (0.5x, 0.75x, 1x, 1.25x, 1.5x) trả về định dạng audio/mpeg.',
  })
  @ApiResponse({
    status: 200,
    description: 'Audio file stream MP3',
  })
  async generateTts(@Body() dto: TtsRequestDto, @Res() res: Response) {
    const audioBuffer = await this.speakingService.generateTts(
      dto.text,
      dto.accent,
      dto.rate,
    );

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'public, max-age=604800, immutable',
    });

    res.send(audioBuffer);
  }

  @UseGuards(AiRateLimitGuard)
  @Post('part3-5/submit')
  @ApiOperation({
    summary:
      'Chấm điểm TOEIC Speaking Part 3-5 (Trả lời câu hỏi / Nêu giải pháp / Ý kiến)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        promptText: { type: 'string', description: 'Nội dung câu hỏi đề bài' },
        studentResponse: {
          type: 'string',
          description: 'Bài nói hoặc transcript của học viên',
        },
      },
    },
  })
  submitPart3To5(
    @Body('promptText') promptText: string,
    @Body('studentResponse') studentResponse: string,
  ) {
    return this.speakingService.evaluateSpeakingPart3To5(
      promptText,
      studentResponse,
    );
  }
}
