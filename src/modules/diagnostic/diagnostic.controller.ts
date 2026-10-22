import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DiagnosticService } from './diagnostic.service';
import { DiagnosticSpeakingService } from './diagnostic-speaking.service';
import { DiagnosticWritingService } from './diagnostic-writing.service';

@ApiTags('diagnostic')
@Controller('diagnostic')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DiagnosticController {
  constructor(
    private readonly diagnosticService: DiagnosticService,
    private readonly speakingService: DiagnosticSpeakingService,
    private readonly writingService: DiagnosticWritingService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: 'Lấy bài kiểm tra đầu vào đang hoạt động' })
  getCurrent(@Request() req: { user: { id: number } }) {
    return this.diagnosticService.getCurrentAssessment(req.user.id);
  }

  @Post(':id/attempts/start')
  start(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.diagnosticService.startAttempt(req.user.id, id);
  }

  @Post(':id/attempts/:attemptId/speaking/:questionId/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('audio'))
  confirmSpeaking(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) assessmentId: number,
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body('durationMs') durationMs: string,
    @UploadedFile() audio: Express.Multer.File,
  ) {
    return this.speakingService.confirmRecording(
      req.user.id,
      assessmentId,
      attemptId,
      questionId,
      audio,
      Number(durationMs),
    );
  }

  @Post(':id/attempts/:attemptId/speaking/:questionId/skip')
  skipSpeaking(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) assessmentId: number,
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ) {
    return this.speakingService.skip(
      req.user.id,
      assessmentId,
      attemptId,
      questionId,
    );
  }

  @Get(':id/attempts/:attemptId/speaking')
  getSpeakingResponses(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) assessmentId: number,
    @Param('attemptId', ParseIntPipe) attemptId: number,
  ) {
    return this.speakingService.list(req.user.id, assessmentId, attemptId);
  }

  @Post(':id/attempts/:attemptId/writing/:questionId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retryWriting(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) assessmentId: number,
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ) {
    return this.writingService.retry(
      req.user.id,
      assessmentId,
      attemptId,
      questionId,
    );
  }

  @Get('speaking-responses/:responseId/audio')
  getSpeakingAudio(
    @Request() req: { user: { id: number } },
    @Param('responseId', ParseIntPipe) responseId: number,
  ) {
    return this.speakingService.audio(req.user.id, responseId);
  }

  @Get('results/latest')
  @ApiOperation({
    summary: 'Lấy kết quả kiểm tra đầu vào gần nhất của học viên',
  })
  getLatestResult(@Request() req: { user: { id: number } }) {
    return this.diagnosticService.getLatestResult(req.user.id);
  }

  @Post(':id/attempts')
  @ApiOperation({
    summary: 'Nộp bài kiểm tra đầu vào và nhận kết quả từ server',
  })
  submit(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { answers?: unknown; submissionToken?: string; attemptId?: number },
  ) {
    return this.diagnosticService.submitAssessment(
      req.user.id,
      id,
      body?.answers,
      body?.submissionToken,
      body?.attemptId,
    );
  }
}
