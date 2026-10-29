import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable, pipeline } from 'node:stream';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AttemptMode, Role } from '@prisma/client';
import { ToeicService } from './toeic.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { StartAttemptDto } from './dto/start-attempt.dto';
import { SaveAnswersDto } from './dto/save-answers.dto';
import { IntegrityEventDto } from './dto/integrity-event.dto';
import { ToeicGoalDto } from './dto/toeic-goal.dto';

@Controller('toeic')
export class ToeicController {
  constructor(private readonly toeicService: ToeicService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get('exams')
  getExams(@Req() req: any) {
    const isStaff = req?.user?.role === Role.ADMIN;
    return this.toeicService.getExams(isStaff);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  getHistory(@Req() req: any) {
    return this.toeicService.getHistory(req.user.id);
  }

  @Get('stats/listening-reading')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Thống kê kết quả TOEIC Listening & Reading của học viên (days = 7, 30, 90, 365; bỏ trống = toàn bộ)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Tổng quan, theo kỹ năng, theo Part và dạng câu hỏi, mục tiêu, danh sách lượt đã nộp',
  })
  getLrStats(@Req() req: any, @Query('days') days?: string) {
    const n = Number(days);
    const allowed = [7, 30, 90, 365];
    return this.toeicService.getLrStats(
      req.user.id,
      allowed.includes(n) ? n : null,
    );
  }

  @Patch('stats/goal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lưu ngày dự thi và điểm mục tiêu TOEIC' })
  @ApiResponse({
    status: 200,
    description: '{ examDate, daysUntilExam, targetScore }',
  })
  @ApiResponse({ status: 400, description: 'Ngày hoặc điểm không hợp lệ' })
  saveGoal(@Req() req: any, @Body() body: ToeicGoalDto) {
    return this.toeicService.saveToeicGoal(req.user.id, body);
  }

  @Get('exams/:examId/briefing')
  @UseGuards(JwtAuthGuard)
  getExamBriefing(
    @Param('examId', ParseIntPipe) examId: number,
    @Req() req: any,
  ) {
    const isStaff = req?.user?.role === Role.ADMIN;
    return this.toeicService.getExamBriefing(examId, req.user?.id, isStaff);
  }

  @Get('exams/:examId')
  @UseGuards(JwtAuthGuard)
  getExamDetails(
    @Param('examId', ParseIntPipe) examId: number,
    @Req() req: any,
  ) {
    const isStaff = req?.user?.role === Role.ADMIN;
    return this.toeicService.getExamBriefing(examId, req.user?.id, isStaff);
  }

  @Get('bundles/:quizId')
  @UseGuards(JwtAuthGuard)
  getBundle(@Param('quizId', ParseIntPipe) quizId: number, @Req() req: any) {
    return this.toeicService.getBundle(quizId, req.user?.role === Role.ADMIN);
  }

  @Get('groups/:groupId/audio')
  @UseGuards(JwtAuthGuard)
  async getGroupAudio(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Query('attemptId') attemptId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const parsedGroupId = Number(groupId);
    const parsedAttemptId = Number(attemptId);
    if (
      !Number.isInteger(parsedGroupId) ||
      !Number.isInteger(parsedAttemptId) ||
      parsedGroupId < 1 ||
      parsedAttemptId < 1
    ) {
      return res.status(400).json({ message: 'Tham số audio không hợp lệ' });
    }
    const audioBuffer = await this.toeicService.generateGroupAudio(
      parsedGroupId,
      req.user.id,
      parsedAttemptId,
    );
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(audioBuffer);
  }

  @Post('exams/:examId/attempts')
  @UseGuards(JwtAuthGuard)
  startAttempt(
    @Param('examId', ParseIntPipe) examId: number,
    @Req() req: any,
    @Body() body: StartAttemptDto,
  ) {
    return this.toeicService.startAttempt(
      req.user.id,
      examId,
      body?.mode ?? AttemptMode.PRACTICE,
      body?.parts ?? [],
    );
  }

  @Post('attempts/:id/begin')
  @UseGuards(JwtAuthGuard)
  beginAttempt(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.beginAttempt(id, req.user.id);
  }

  @Get('attempts/:id')
  @UseGuards(JwtAuthGuard)
  getAttempt(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.getAttemptDetail(id, req.user.id, req.user.role);
  }

  @Post('attempts/:id/cancel')
  @UseGuards(JwtAuthGuard)
  cancelAttempt(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.cancelAttempt(id, req.user.id);
  }

  @Get('attempts/:id/remaining-time')
  @UseGuards(JwtAuthGuard)
  getRemainingTime(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.getRemainingTime(id, req.user.id, req.user.role);
  }

  @Get('listening-master/:examId/audio')
  @ApiOperation({
    summary:
      'Bản ghi Listening liền mạch của lượt thi (bản dựng trên máy hoặc bản đã publish, qua backend; hỗ trợ Range)',
  })
  @ApiResponse({ status: 200, description: 'audio/mpeg' })
  @ApiQuery({
    name: 'grant',
    description:
      'Quyền nghe ngắn hạn do GET /toeic/attempts/:id/listening/master cấp',
  })
  @ApiResponse({
    status: 404,
    description: 'Không có bản dựng khớp registry, hoặc thiếu/sai quyền nghe',
  })
  async getLocalListeningMaster(
    @Param('examId', ParseIntPipe) examId: number,
    @Query('grant') grant: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // The whole Listening section of the exam: streamed only with a grant
    // for an attempt that still allows playback (checked on every request).
    // The local file is used only when its sha256 matches the registry.
    const source = await this.toeicService.resolveListeningMasterStream(
      examId,
      grant,
    );
    if (!source) {
      res.status(404).json({ statusCode: 404, message: 'Not found' });
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if ('file' in source) {
      res.sendFile(source.file, { acceptRanges: true });
      return;
    }
    // Published object: proxied so the storage URL never reaches the
    // learner. Only a plain byte range is forwarded.
    const range = /^bytes=\d*-\d*$/.test(req.headers.range ?? '')
      ? req.headers.range!
      : undefined;
    const upstream = await fetch(source.url, {
      headers: range ? { Range: range } : {},
    }).catch(() => null);
    if (
      !upstream?.body ||
      (upstream.status !== 200 && upstream.status !== 206)
    ) {
      res.status(404).json({ statusCode: 404, message: 'Not found' });
      return;
    }
    res.status(upstream.status);
    res.setHeader('Accept-Ranges', 'bytes');
    for (const header of ['content-length', 'content-range'])
      if (upstream.headers.get(header))
        res.setHeader(header, upstream.headers.get(header)!);
    // pipeline also aborts the upstream read when the player disconnects
    // (every seek does).
    pipeline(Readable.fromWeb(upstream.body as any), res, () => undefined);
  }

  @Get('attempts/:id/listening/master')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Bản ghi Listening liền mạch (lượt đang làm, hoặc nghe lại sau khi nộp)',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ available: true, url, durationSeconds, timeline } hoặc { available: false, reason }',
  })
  getListeningMaster(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.getListeningMaster(id, req.user.id);
  }

  @Get('attempts/:id/listening/manifest')
  @UseGuards(JwtAuthGuard)
  getListeningManifest(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.getListeningManifest(id, req.user.id);
  }

  @Post('attempts/:id/listening/advance')
  @UseGuards(JwtAuthGuard)
  advanceListening(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.advanceListening(id, req.user.id);
  }

  @Patch('attempts/:id/answers')
  @UseGuards(JwtAuthGuard)
  saveAnswers(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body() body: SaveAnswersDto,
  ) {
    return this.toeicService.saveAnswers(id, req.user.id, body);
  }

  @Post('attempts/:id/submit')
  @UseGuards(JwtAuthGuard)
  submitAttempt(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.submitAttempt(id, req.user.id);
  }

  @Post('attempts/:id/integrity-events')
  @UseGuards(JwtAuthGuard)
  recordIntegrityEvent(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body() body: IntegrityEventDto,
  ) {
    return this.toeicService.recordIntegrityEvent(
      id,
      req.user.id,
      body.eventType,
      body.questionId,
      body.metadata,
    );
  }

  @Get('attempts/:id/result')
  @UseGuards(JwtAuthGuard)
  getResult(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.getResult(id, req.user.id, req.user.role);
  }

  @Get('attempts/:id/review')
  @UseGuards(JwtAuthGuard)
  getReview(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.toeicService.getReview(id, req.user.id, req.user.role);
  }
}
